require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

// Only pass PRIVATE_KEY to live networks when it's a real 32-byte hex key.
// A placeholder / empty value would otherwise make Hardhat throw at config load,
// blocking even `compile` and `test` (which never touch the live networks).
const RAW_KEY = process.env.PRIVATE_KEY || "";
const PK = /^0x[0-9a-fA-F]{64}$/.test(RAW_KEY)
  ? [RAW_KEY]
  : /^[0-9a-fA-F]{64}$/.test(RAW_KEY)
    ? ["0x" + RAW_KEY]
    : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.34",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  sourcify: {
    enabled: true,
  },
  networks: {
    alfajores: {
      url: "https://rpc.ankr.com/celo_alfajores",
      accounts: PK,
      chainId: 44787,
    },
    celo: {
      url: "https://forno.celo.org",
      accounts: PK,
      chainId: 42220,
    },
  },
  etherscan: {
    apiKey: {
      celo: process.env.CELOSCAN_API_KEY || "",
      alfajores: process.env.CELOSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io",
        },
      },
      {
        network: "alfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api-alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io",
        },
      },
    ],
  },
};
