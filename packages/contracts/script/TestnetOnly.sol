// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @title TestnetOnly
/// @notice Base of every Winz script: refuses to run on a mainnet. The project runs on Arc testnet
///         only (SPEC section 0, hypothesis 3) and no script is meant to touch real funds.
abstract contract TestnetOnly is Script {
    /// @notice Ethereum mainnet.
    uint256 internal constant ETHEREUM_MAINNET_CHAIN_ID = 1;
    /// @notice Arc mainnet.
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;

    /// @notice Raised when a script is run against a mainnet.
    error MainnetRefused(uint256 chainId);

    /// @dev Reverts on a mainnet chain id. Called first by every entry point.
    function _refuseMainnet() internal view {
        if (block.chainid == ETHEREUM_MAINNET_CHAIN_ID || block.chainid == ARC_MAINNET_CHAIN_ID) {
            revert MainnetRefused(block.chainid);
        }
    }

    /// @dev Path of the deployment record of the current chain, relative to the package root.
    function _deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }
}
