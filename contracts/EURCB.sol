pragma solidity >=0.6.0  <0.7.0;

import "./BaseToken.sol";

contract EURCB is Basetoken{

    constructor() Basetoken("Euro", "EURCB") public{

    }
}
