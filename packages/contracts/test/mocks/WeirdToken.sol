// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice 6-decimal token whose `transfer` can be switched to the non-standard behaviours seen in
///         the wild, and to a reentrant call. `transferFrom` and `approve` always behave.
/// @dev Test only. Used to pin what WinzEscrow counts as a successful refund transfer.
contract WeirdToken {
    enum Mode {
        Standard, // returns true
        NoReturnData, // succeeds and returns nothing (USDT style)
        ReturnsFalse, // does not move tokens, returns false
        ReturnsGarbage, // moves tokens, returns 2
        Reenters // calls back into `reenterTarget` before moving tokens, bubbling its revert
    }

    Mode public mode;
    address public reenterTarget;
    bytes public reenterData;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function setReentry(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external {
        Mode m = mode;
        if (m == Mode.ReturnsFalse) {
            _return(0);
        }
        if (m == Mode.Reenters) {
            (bool ok, bytes memory data) = reenterTarget.call(reenterData);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
        _move(msg.sender, to, amount);
        if (m == Mode.NoReturnData) return;
        _return(m == Mode.ReturnsGarbage ? 2 : 1);
    }

    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function _return(uint256 value) private pure {
        assembly ("memory-safe") {
            mstore(0x00, value)
            return(0x00, 0x20)
        }
    }
}
