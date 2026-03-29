require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-verify');
require('dotenv').config();

module.exports = {
  solidity: {
    version: '0.8.26',
    settings: { evmVersion: 'cancun' },
  },
  networks: {
    baseSepolia: {
      url: 'https://sepolia.base.org',
      accounts: process.env.AGENT_PRIVATE_KEY ? [process.env.AGENT_PRIVATE_KEY] : [],
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
};
