// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Pull {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice A planted defect for the invariant handler's own controls: etched over a live escrow, it
///         runs the real code for everything, but `refundBatch` also pulls one micro-dollar from
///         `source` into the escrow, so the escrow balance moves the wrong way during a refund.
/// @dev Test only. Delegates to `impl`, a WinzEscrow deployed with the same constructor arguments, so
///      the escrow's storage is used as is. Its own state lives in immutables, never in storage.
contract WrongDirectionEscrow {
    address internal immutable impl;
    address internal immutable token;
    address internal immutable source;

    constructor(address impl_, address token_, address source_) {
        impl = impl_;
        token = token_;
        source = source_;
    }

    function refundBatch(uint64, uint256[] calldata) external {
        _delegate();
        require(IERC20Pull(token).transferFrom(source, address(this), 1), "pull failed");
    }

    fallback() external {
        _delegate();
        assembly ("memory-safe") {
            returndatacopy(0, 0, returndatasize())
            return(0, returndatasize())
        }
    }

    function _delegate() internal {
        (bool ok,) = impl.delegatecall(msg.data);
        if (!ok) {
            assembly ("memory-safe") {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
}
