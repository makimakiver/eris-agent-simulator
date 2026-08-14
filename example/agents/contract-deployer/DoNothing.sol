// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title DoNothing
/// @notice A contract whose function returns nothing. It holds no state and no funds --
///         calling doNothing() succeeds and returns no data.
contract DoNothing {
    /// @notice Does nothing and returns nothing.
    function doNothing() external {}
}
