// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {WinzEscrow} from "../src/WinzEscrow.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

/// @title Approve
/// @notice The broadcasting account approves the escrow for the maximum amount of its token. The
///         treasury runs it once after deployment (and again after a role rotation to a new
///         treasury): the escrow pulls budgets, purchases and merchant payments from it.
/// @dev The escrow is APPROVE_ESCROW when set, else the `escrow` of deployments/<chainId>.json. The
///      token is the escrow's own `usdc()`, so the approval can never target another token. The
///      broadcaster must be the escrow's current treasury: an approval from any other account would
///      have no effect on the escrow and most likely means the wrong key was passed.
contract Approve is TestnetOnly {
    /// @notice No APPROVE_ESCROW and no deployment record for this chain.
    error NoEscrow(string recordPath);
    /// @notice The broadcasting account is not the escrow's treasury.
    error NotTreasury(address broadcaster, address treasury);
    /// @notice The allowance read back after the approval is not the maximum.
    error AllowanceNotSet(uint256 allowance);

    /// @notice Entry point of `forge script`.
    function run() external returns (address escrow, address token) {
        _refuseMainnet();
        escrow = escrowAddress();
        token = approve(escrow);
    }

    /// @notice APPROVE_ESCROW, or the escrow recorded in deployments/<chainId>.json.
    function escrowAddress() public view returns (address) {
        string memory fromEnv = vm.envOr("APPROVE_ESCROW", string(""));
        if (bytes(fromEnv).length != 0) return vm.parseAddress(fromEnv);
        string memory path = _deploymentPath();
        if (!vm.exists(path)) revert NoEscrow(path);
        return vm.parseJsonAddress(vm.readFile(path), ".escrow");
    }

    /// @notice Approves `escrow` for `type(uint256).max` of its token, from the broadcaster.
    /// @return token The token approved, `escrow.usdc()`.
    function approve(address escrow) public returns (address token) {
        _refuseMainnet();
        WinzEscrow target = WinzEscrow(escrow);
        token = target.usdc();
        address treasury = target.treasury();

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        if (broadcaster != treasury) {
            vm.stopBroadcast();
            revert NotTreasury(broadcaster, treasury);
        }
        IERC20(token).approve(escrow, type(uint256).max);
        vm.stopBroadcast();

        uint256 allowance = IERC20(token).allowance(treasury, escrow);
        if (allowance != type(uint256).max) revert AllowanceNotSet(allowance);
        console2.log("Treasury", treasury, "approved escrow", escrow);
    }
}
