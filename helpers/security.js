const axios = require('axios');
const secp256k1 = require("secp256k1");
const crypto = require('crypto');
const web3 = require('./web3')
const {BadRequest} = require('./error')
//Its not used with Infura
const unlockAccount= async () => {
    // try {
    //     const response= await web3.eth.personal.unlockAccount(process.env.UNLOCK_ACCOUNT, process.env.UNLOCK_PASSWORD, process.env.UNLOCK_TIME);
    //
    //     if(!response) {
    //         throw new BadRequest('Someting went wrong. Unlocking Master Account');
    //     }
    // }catch (e) {
    //     console.log(e)
    // }

}

const signTransaction = async(payload) => {

    // transferPreSignedHashing from Utils.sol
    // function transferPreSignedHashing(address _token, address _to, uint256 _value, uint256 _fee, uint256 _nonce)
    // return keccak256(abi.encode(bytes4(0x15420b71), _token, _to, _value, _fee, _nonce));
    const input = web3.eth.abi.encodeParameters(
        ["bytes4", "address", "address", "uint256", "uint256", "uint256"],
        [
            "0x15420b71",
            payload.addressContract.toString(),
            payload.to.toString(),
            payload.amount,
            payload.fee.toString(),
            payload.nonce.toString()
        ]
    );


    const inputHash = web3.utils.keccak256(input);

    let strPrivateKey = payload.privateKey.substring(0, 2) === "0x"  ? payload.privateKey.substring(2) : payload.privateKey;

    const signObj =secp256k1.sign(Buffer.from(inputHash.substring(2), "hex"), Buffer.from(strPrivateKey, "hex"));

    const signatureInHex =  "0x" + signObj.signature.toString("hex") +  (signObj.recovery + 27).toString(16);

    return signatureInHex;
}
const encrypt=(privateKey, password)=> {
    let key = crypto.createHash('sha256').update(String(password)).digest('base64').substr(0, 32);
    const algorithm = 'aes-256-cbc';
    const iv = crypto.randomBytes(16);
    let cipher = crypto.createCipheriv(algorithm,key, iv);

    let encrypted = cipher.update(privateKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted.toString('hex')
    };
}

const decrypt=(privateKeyEncrypted, password )=> {
    const algorithm = 'aes-256-cbc';
    let key = crypto.createHash('sha256').update(String(password)).digest('base64').substr(0, 32);

    let iv = Buffer.from(privateKeyEncrypted.iv, 'hex');
    let encryptedText = Buffer.from(privateKeyEncrypted.encryptedData, 'hex');
    let decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAutoPadding(false);
    let decrypted = decipher.update(encryptedText);

    decrypted = Buffer.concat([decrypted, decipher.final()]);
    //Al final tenia un caracter extrano
    const keyDecrypted=decrypted.toString().replace(/[^\x20-\x7E]/g, '');
    return keyDecrypted;
}

const converter =(value) => {
   return web3.utils.toWei(value.toString())
};

const estimateGas = async()=>{
        let response = await axios.get('https://ethgasstation.info/json/ethgasAPI.json');
        let prices = {
            low: response.data.safeLow/10,
            medium: response.data.average/10,
            high: response.data.fast/10
        };
        return prices;
}




module.exports = {
    unlockAccount,
    signTransaction,
    encrypt,
    decrypt,
    converter,
    estimateGas
};
