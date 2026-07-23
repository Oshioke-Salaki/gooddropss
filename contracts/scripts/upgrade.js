const { ethers, upgrades, network } = require("hardhat");

// Upgrades the existing UUPS proxy to the current GoodDrops implementation
// (adds createManyDrops). The deployer MUST be the contract owner — _authorizeUpgrade
// is onlyOwner. Run against Alfajores first, verify, then mainnet.
//
//   npm run upgrade:alfajores      (set ALFAJORES_PROXY first)
//   npm run upgrade:celo
//
// Storage-safe: this change adds only a function, a constant and errors — no new
// or reordered state variables — so the layout is unchanged.

const PROXIES = {
  celo:      "0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131", // mainnet proxy
  alfajores: process.env.ALFAJORES_PROXY || "",            // set after a testnet deploy
};

async function main() {
  const proxy = process.env.PROXY_ADDRESS || PROXIES[network.name];
  if (!proxy) {
    throw new Error(`No proxy address for "${network.name}". Set PROXY_ADDRESS env or add it to PROXIES in upgrade.js.`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`\n=== GoodDrops Upgrade ===`);
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}   (must be the contract owner)`);
  console.log(`Proxy:    ${proxy}`);

  const before = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`Current implementation: ${before}`);

  const GoodDrops = await ethers.getContractFactory("GoodDrops");

  console.log(`\nValidating storage layout + deploying the new implementation...`);
  const upgraded = await upgrades.upgradeProxy(proxy, GoodDrops, {
    kind: "uups",
    // OZ 5.x ReentrancyGuard is stateless but has a constructor the plugin
    // false-flags; the proxy was originally deployed with this same allowance.
    unsafeAllow: ["constructor"],
  });
  await upgraded.waitForDeployment();

  const after = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`\n✅ Upgraded.`);
  console.log(`   New implementation: ${after}`);

  // Smoke-check the new surface is live.
  const maxBatch = await upgraded.MAX_BATCH_DROPS();
  console.log(`   MAX_BATCH_DROPS:    ${maxBatch}`);

  console.log(`\nNext steps:`);
  console.log(`  1. Verify the new implementation:`);
  console.log(`     npx hardhat verify --network ${network.name} ${after}`);
  console.log(`  2. No subgraph change needed — createManyDrops emits the same DropCreated events.`);
  console.log(`  3. No dapp address change — the proxy address is unchanged.\n`);
}

// If this machine has no local .openzeppelin manifest for the proxy, the plugin
// may ask you to import it first:
//   await upgrades.forceImport(proxy, await ethers.getContractFactory("GoodDrops"), { kind: "uups" });
// Run that once (it only reads on-chain state), then re-run this script.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
