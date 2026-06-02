/**
 * Initializes an already-deployed but uninitialized GoodDrops proxy.
 *
 * Run only when the proxy contract has never had initialize() called —
 * confirmed by owner() == address(0) and maxDropAmount == 0.
 *
 * Usage:
 *   npx hardhat run scripts/initialize.js --network celo
 */
const { ethers, network } = require("hardhat");

const ADDRESSES = {
  celo: {
    proxy:            "0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131",
    gToken:           "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A",
    identityContract: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
  },
  alfajores: {
    proxy:            "", // fill in if needed
    gToken:           "0x67C5870b4A41D4Ebef24d2456547A03F1f3e094B",
    identityContract: "0x73d1f8e5A1F380c0b8bDDc1e4cAeB8FD72dbf17C",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainName  = network.name;
  const cfg        = ADDRESSES[chainName];

  if (!cfg?.proxy) throw new Error(`No proxy address configured for "${chainName}"`);

  console.log(`\n=== GoodDrops — Initialize Proxy ===`);
  console.log(`Network:  ${chainName}`);
  console.log(`Caller:   ${deployer.address}`);
  console.log(`Proxy:    ${cfg.proxy}`);
  console.log(`gToken:   ${cfg.gToken}`);
  console.log(`Identity: ${cfg.identityContract}`);
  console.log(`Owner:    ${deployer.address}\n`);

  const GoodDrops = await ethers.getContractFactory("GoodDrops");
  const proxy     = GoodDrops.attach(cfg.proxy);

  // Safety check — bail if already initialized
  const currentOwner = await proxy.owner();
  if (currentOwner !== ethers.ZeroAddress) {
    console.log(`Already initialized! Owner: ${currentOwner}`);
    process.exit(0);
  }

  console.log("Calling initialize()...");
  const tx = await proxy.initialize(cfg.gToken, cfg.identityContract, deployer.address);
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log("Confirmed.\n");

  // Verify
  const [owner, maxDrop, minDrop, identReq, minExp, maxExp] = await Promise.all([
    proxy.owner(),
    proxy.maxDropAmount(),
    proxy.minDropAmount(),
    proxy.identityRequired(),
    proxy.minExpiryDuration(),
    proxy.maxExpiryDuration(),
  ]);

  console.log("── Post-init state ──────────────────────────────");
  console.log(`   owner:             ${owner}`);
  console.log(`   maxDropAmount:     ${ethers.formatEther(maxDrop)} G$`);
  console.log(`   minDropAmount:     ${ethers.formatEther(minDrop)} G$`);
  console.log(`   identityRequired:  ${identReq}`);
  console.log(`   minExpiryDuration: ${Number(minExp) / 3600}h`);
  console.log(`   maxExpiryDuration: ${Number(maxExp) / 86400}d`);
  console.log("─────────────────────────────────────────────────\n");
  console.log("✅ Done. You can now create and claim drops.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
