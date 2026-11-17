// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDC
/// @notice Mintable 6-decimal stand-in for USDC, with a blocklist switch. Used by the tests and as the
///         fallback token of the demo if the testnet USDC allocation does not come through.
/// @dev Never a store of value: anyone can mint. Only the deployer can block an address, so that a
///      public demo cannot be frozen by a visitor.
contract TestUSDC is ERC20, Ownable {
    /// @notice True when transfers to or from the address revert.
    mapping(address account => bool) public blocked;

    event BlockedSet(address indexed account, bool blocked);

    error AccountBlocked(address account);

    constructor() ERC20("Test USDC", "tUSDC") Ownable(msg.sender) {}

    /// @notice USDC uses 6 decimals, not the ERC-20 default of 18.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints `amount` micro-USDC to `to`. Open to anyone.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Blocks or unblocks `account`, like the USDC blocklist. Owner only.
    function setBlocked(address account, bool isBlocked) external onlyOwner {
        blocked[account] = isBlocked;
        emit BlockedSet(account, isBlocked);
    }

    /// @dev Every balance change (transfer, mint, burn) goes through here.
    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert AccountBlocked(from);
        if (blocked[to]) revert AccountBlocked(to);
        super._update(from, to, value);
    }
}
