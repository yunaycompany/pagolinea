pragma solidity >=0.6.0  <0.7.0;


import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ERC865Plus677ish.sol";

abstract contract Basetoken is ERC20, ERC865Plus677ish {

    using SafeMath for uint256;
    using ECDSA for bytes32;
    using Address for address;

    /**
    * Events
    */


    event MyLog( address indexed _from, uint256 _value);


    // ownership
    address public owner;
    uint8 private _decimals;

    // nonces of transfers performed
    mapping(bytes => bool) signatures;



    constructor(string memory name, string memory symbol ) ERC20(name, symbol) public {
        owner = msg.sender;
    }

    //**************** OVERRIDE ERC20 *******************************************************************************************
    /**
     * @dev Allows the current owner to transfer the ownership.
     * @param _newOwner The address to transfer ownership to.
     */
    function transferOwnership(address _newOwner) public onlyOwner {
        require(owner == msg.sender,'Only owner can transfer the ownership');
        owner = _newOwner;
    }


    /**
     * Minting functionality to multiples recipients
     */
    function mint(address[] memory _recipients, uint256[] memory _amounts) public onlyOwner  {
        require(owner == msg.sender,'Only owner can add new tokens');
        require(_recipients.length == _amounts.length,'Invalid size of recipients|amount');
        require(_recipients.length <= 10,'Only allow mint 10 recipients');

        for (uint8 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];
            uint256 amount = _amounts[i];

            _mint(recipient, amount);
        }
    }






    function doTransfer(address _from, address _to, uint256 _value, uint256 _fee, address _feeAddress) internal {
        emit MyLog(_from,  _value);

        require(_to != address(0),'Invalid recipient address');

        uint256 total = _value.add(_fee);
        require(total <= balanceOf(_from),'Insufficient funds');


        emit MyLog(_from, _value);
        myTransferFrom(_from,_to,_value);

        //Agregar el fee a la address fee
        if(_fee > 0 && _feeAddress != address(0)) {
            myTransferFrom(_from,_feeAddress,_fee);

        }


    }

    /**
      * @dev See {IERC20-transferFrom}.
      *
      * Emits an {Approval} event indicating the updated allowance. This is not
      * required by the EIP. See the note at the beginning of {ERC20};
      *
      * Requirements:
      * - `sender` and `recipient` cannot be the zero address.
      * - `sender` must have a balance of at least `amount`.
      * - the caller must have allowance for ``sender``'s tokens of at least
      * `amount`.
      */
    function myTransferFrom(address from, address to, uint256 amount) public onlyOwner returns (bool) {
        _transfer(from, to, amount);
        //Check if allow use amount to spent
        uint256 allowed= allowance(msg.sender, from);
        uint256 diff=allowed.sub(amount);
        _approve(from, msg.sender, diff);
        return true;
    }



    //**************** END OVERRIDE ERC20 *******************************************************************************************






    //**************** FROM ERC865 *******************************************************************************************
    function transferAndCall(address _to, uint256 _value, bytes4 _methodName, bytes memory _args) public override returns (bool) {
        require(transferFromSender(_to, _value),'Invalid transfer from sender');

        emit TransferAndCall(msg.sender, _to, _value, _methodName, _args);

        // call receiver
        require(Address.isContract(_to),'Address is not contract');

        (bool success, ) = _to.call(abi.encodePacked(abi.encodeWithSelector(_methodName, msg.sender, _value), _args));
        require(success, 'Transfer unsuccesfully');
        return success;
    }

    //ERC 865 + delegate transfer and call
    function transferPreSigned(bytes memory _signature, address _from, address _to, uint256 _value, uint256 _fee, uint256 _nonce) public override returns (bool) {

        require(!signatures[_signature],'Signature already used');

        bytes32 hashedTx = transferPreSignedHashing(address(this), _to, _value, _fee, _nonce);

        address from = ECDSA.recover(hashedTx, _signature);

        //if hashedTx does not fit to _signature Utils.recover resp. Solidity's ecrecover returns another (random) address,
        //if this returned address does have enough tokens, they would be transferred, therefor we check if the retrieved
        //signature is equal the specified one
        require(from == _from,'Invalid sender1');
        require(from != address(0),'Invalid sender address');



        doTransfer(from, _to, _value, _fee, msg.sender);
        signatures[_signature] = true;


        emit TransferPreSigned(from, _to, msg.sender, _value, _fee);
        return true;
    }


    function transferAndCallPreSigned(bytes memory _signature, address _from, address _to, uint256 _value, uint256 _fee, uint256 _nonce,
        bytes4 _methodName, bytes memory _args) public override returns (bool) {

        require(!signatures[_signature],'Signature already used');

        bytes32 hashedTx = transferAndCallPreSignedHashing(address(this), _to, _value, _fee, _nonce, _methodName, _args);
        address from = ECDSA.recover(hashedTx, _signature);

        /**
        *if hashedTx does not fit to _signature Utils.recover resp. Solidity's ecrecover returns another (random) address,
        *if this returned address does have enough tokens, they would be transferred, therefor we check if the retrieved
        *signature is equal the specified one
        **/
        require(from == _from,'Invalid sender');
        require(from != address(0),'Invalid sender address');

        doTransfer(from, _to, _value, _fee, msg.sender);
        signatures[_signature] = true;


        emit TransferAndCallPreSigned(from, _to, msg.sender, _value, _fee, _methodName, _args);

        // call receiver
        require(Address.isContract(_to),'Address is not contract');

        //call on behalf of from and not msg.sender
        (bool success, ) = _to.call(abi.encodePacked(abi.encodeWithSelector(_methodName, from, _value), _args));
        require(success);
        return success;
    }

    //**************** END FROM ERC865 *******************************************************************************************







    //*****************************UTILS FUNCTIONS****************************************************************
    /**
     * From: https://github.com/PROPSProject/props-token-distribution/blob/master/contracts/token/ERC865Token.sol
     * adapted to: https://solidity.readthedocs.io/en/v0.5.3/050-breaking-changes.html?highlight=abi%20encode
     * @notice Hash (keccak256) of the payload used by transferPreSigned
     * @param _token address The address of the token.
     * @param _to address The address which you want to transfer to.
     * @param _value uint256 The amount of tokens to be transferred.
     * @param _fee uint256 The amount of tokens paid to msg.sender, by the owner.
     */
    function transferAndCallPreSignedHashing(address _token, address _to, uint256 _value, uint256 _fee, uint256 _nonce,
        bytes4 _methodName, bytes memory _args) internal pure returns (bytes32) {
        /* "38980f82": transferAndCallPreSignedHashing(address,address,uint256,uint256,uint256,bytes4,bytes) */
        return keccak256(abi.encode(bytes4(0x38980f82), _token, _to, _value, _fee, _nonce, _methodName, _args));
    }

    function transferPreSignedHashing(address _token, address _to, uint256 _value, uint256 _fee, uint256 _nonce)
    internal pure returns (bytes32) {
        /* "15420b71": transferPreSignedHashing(address,address,uint256,uint256,uint256) */
        return keccak256(abi.encode(bytes4(0x15420b71), _token, _to, _value, _fee, _nonce));
    }


    function transferFromSender(address _to, uint256 _value) private returns (bool) {
        doTransfer(msg.sender, _to, _value, 0, address(0));
        return true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Access denied");
        _;
    }


    //*****************************END UTILS FUNCTIONS**********************************************************

}
