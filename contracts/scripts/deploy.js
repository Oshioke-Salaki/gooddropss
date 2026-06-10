const { ethers, upgrades, network } = require("hardhat");

// ─── Addresses ───────────────────────────────────────────────────────────────

const ADDRESSES = {
  celo: {
    gToken:           "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    identityContract: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
  },
  alfajores: {
    gToken:           "0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B",
    identityContract: "0x73d1f8e5A1F380c0b8bDDc1e4cAeB8FD72dbf17C", // Alfajores identity
  },
};

// ─── Deploy ───────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainName  = network.name;

  console.log(`\n=== GoodDrops Deployment ===`);
  console.log(`Network:  ${chainName}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} CELO\n`);

  const cfg = ADDRESSES[chainName];
  if (!cfg) {
    throw new Error(`No address config for network "${chainName}". Add it to ADDRESSES in deploy.js.`);
  }

  console.log(`G$ token:          ${cfg.gToken}`);
  console.log(`Identity contract: ${cfg.identityContract}`);
  console.log(`Owner / admin:     ${deployer.address}\n`);

  // Deploy implementation + ERC-1967 proxy in one step
  const GoodDrops = await ethers.getContractFactory("GoodDrops");

  console.log("Deploying proxy...");
  const proxy = await upgrades.deployProxy(
    GoodDrops,
    [cfg.gToken, cfg.identityContract, deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log(`\n✅ GoodDrops proxy deployed:          ${proxyAddress}`);
  console.log(`   Implementation (logic contract):   ${implAddress}`);

  // ── Wire up GPS signer ────────────────────────────────────────────────────
  // GPS_SIGNER_KEY is the private key of the server wallet that signs proofs.
  // Derive the public address from it and register it on the contract, then
  // enable gpsRequired so claim() is blocked and only claimWithProof() works.
  const gpsSignerKey = process.env.GPS_SIGNER_KEY;
  if (gpsSignerKey) {
    const gpsWallet   = new ethers.Wallet(gpsSignerKey);
    const gpsAddress  = gpsWallet.address;
    console.log(`Setting GPS signer: ${gpsAddress}`);
    await (await proxy.setGpsSigner(gpsAddress)).wait();
    await (await proxy.setGpsRequired(true)).wait();
    console.log("GPS enforcement: enabled ✅");
  } else {
    console.log("⚠️  GPS_SIGNER_KEY not set — GPS enforcement disabled. Set it and call setGpsSigner + setGpsRequired(true) manually.");
  }

  // Verify initial state
  const maxDrop  = await proxy.maxDropAmount();
  const minDrop  = await proxy.minDropAmount();
  const identReq = await proxy.identityRequired();
  const gpsReq   = await proxy.gpsRequired();
  const gpsSigner = await proxy.gpsSigner();

  console.log(`\n── Initial config ──────────────────────────────`);
  console.log(`   maxDropAmount:     ${ethers.formatEther(maxDrop)} G$`);
  console.log(`   minDropAmount:     ${ethers.formatEther(minDrop)} G$`);
  console.log(`   identityRequired:  ${identReq}`);
  console.log(`   gpsRequired:       ${gpsReq}`);
  console.log(`   gpsSigner:         ${gpsSigner}`);
  console.log(`────────────────────────────────────────────────\n`);

  console.log("Next steps:");
  console.log(`  1. Update dapp contract address:`);
  console.log(`     GOOD_DROPS_ADDRESS = "${proxyAddress}"  in dapp/src/lib/contracts.ts`);
  console.log(`  2. Set GPS_SIGNER_KEY in Vercel (same key used above)`);
  console.log(`  3. Redeploy subgraph pointing to new proxy address`);
  console.log(`  4. Verify on Celoscan:`);
  console.log(`     npx hardhat verify --network ${chainName} ${proxyAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
