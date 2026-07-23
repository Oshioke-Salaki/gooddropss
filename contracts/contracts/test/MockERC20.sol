// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test-only ERC20 standing in for G$ (18 decimals) so createDrop/createManyDrops
// have a token to pull. Freely mintable — never deployed to a real network.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock GoodDollar", "mG$") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
