var bip39 = require('bip39');
var hdkey = require('ethereumjs-wallet/hdkey');
const web3 = require('../helpers/web3')
const {encrypt, decrypt} = require('../helpers/security')
const {getCurrencyId} = require('../helpers/currency')
const {BadRequest,NotFound, ApiError} = require('../helpers/error')
const { tokenContracts } =require('../helpers/getContracts');
const db = require("../models");
const Client = db.client;
const Account = db.account;

exports.createAccount = async(req, res,next) => {
    var body=req.body;
    try{
        if (!body.coin) {
            throw new BadRequest('Coin is required');
        }
        if (!body.password) {
            throw new BadRequest('Password is required');
        }


        let companyId= req.id;
        const password= body.password;
        const coin= body.coin;
        const currencyId = getCurrencyId(coin)

        const d = new Date();
        const extId = web3.utils.sha3( d.getTime() + web3.utils.randomHex(32)+ Math.random(0, 1000000).toString(16));


        //Create Client in DB
        let newClient= await Client.create({
            extId: extId,
            account: '',
            companyId: companyId
        });

        //Create Wallet
        const	mnemonic = bip39.generateMnemonic(128);

        const	seed = await bip39.mnemonicToSeed(mnemonic,password);

        const	master = hdkey.fromMasterSeed(seed);

        const   clientMaster = master.derivePath("m/44'/60'/0'/0");

        const   clientAccount= clientMaster.deriveChild(currencyId);


        const   clientMasterWallet = clientAccount.getWallet();
        const address = clientMasterWallet.getAddressString();

        const privKey = clientAccount.privateExtendedKey()

        const encrypted =encrypt(privKey, password);

        //Guardar encrypted inside Client
        Client.update({account: JSON.stringify(encrypted)}, {
            where: { id: newClient.id }
        }).then(results => {
            if (results.length === 0) {
                throw new ApiError('Problem updating account with wallet', results);
            }
        })

        const privateKey =clientMasterWallet.getPrivateKeyString();
        const encryptedPrivateKey = web3.eth.accounts.encrypt(privateKey,password);

        //Create Account in DB
        //Guardar publicKey and Private Key inside Account
        Account.create({
            currency: coin,
            address: address,
            privateKey: JSON.stringify(encryptedPrivateKey) ,
            clientId: newClient.id
        });

        const response= {
            mnemonic: mnemonic,
            address: address,
            clientId: extId,
            status: true
        }

        res.status(200).send(response);
    }catch (e) {
        next(e)
    }
};

exports.openAccount =  async(req, res,next) =>{
    var body=req.body;
    try{
        const clientId = req.params.client;
        if (!body.coin) {
            throw new BadRequest('Coin is required');
        }
        if (!body.password) {
            throw new BadRequest('Password is required');
        }
        const coin = body.coin;
        const password = body.password;
        const currencyId = getCurrencyId(coin)
        const client= await Client.findOne({
            where: {
                extId: clientId
            }
        })

        if (!client) {
            throw new NotFound('Client not found');
        }

        let account= await Account.findOne({
            where: {
                currency: coin,
                clientId: client.id
            }
        })
        let addressResponse = account? account.address: null;
        if(!account){
            const encrypted = client.account;
            const decoded= JSON.parse(encrypted)

            if(!decoded || !decoded.encryptedData){
                throw new ApiError('Invalid password');
            }
            const decryptedKey = decrypt(decoded, password);


            const	master = hdkey.fromExtendedKey(decryptedKey);
            const   clientAccount= master.deriveChild(currencyId);

            const   clientMasterWallet = clientAccount.getWallet();
            addressResponse = clientMasterWallet.getAddressString();

            const privateKey =clientMasterWallet.getPrivateKeyString();
            const encryptedPrivateKey = web3.eth.accounts.encrypt(privateKey,password);

            //Create Account in DB
            //Guardar publicKey and Private Key inside Account
            Account.create({
                currency: coin,
                address: addressResponse,
                privateKey: JSON.stringify(encryptedPrivateKey) ,
                clientId: client.id
            });
        }

        const response= {
            address: addressResponse,
            status: true
        }

        res.status(200).send(response);


    }catch (e) {
        next(e)
    }
}

exports.getAccount = async(req, res,next) => {
    const coin=req.params.coin;
    try {
        if (!coin) {
            throw new BadRequest('Coin is required');
        }
        const currencyId = getCurrencyId(coin)
        const address = req.params.address;

        const account= await Account.findOne({
            where: {
                address: address
            }
        })

        if (!account) {
            throw new NotFound('Account not found');
        }

        var contract = tokenContracts[currencyId-1];

        let balance= await contract.methods.balanceOf(address).call();

        res.status(200).send({status: true, balance:  balance ?  web3.utils.fromWei(balance.toString(), "ether"): 0});
    }catch (e) {
        next(e)
    }

}

exports.getAccountsByClient = async(req, res,next) => {
    try {
        const clientId = req.params.client;

        const client= await Client.findOne({
            where: {
                extId: clientId
            }
        })
        if (!client) {
            throw new NotFound('Client not found');
        }
        const accounts= await  client.getAccounts()
        let serializedClients=[];
        for (let account of accounts) {
            const currencyId = getCurrencyId(account.currency)

            var contract = tokenContracts[currencyId-1];

            let balance=  await contract.methods.balanceOf(account.address).call();

            let obj= {
                balance: balance? web3.utils.fromWei(balance.toString(), "ether"): 0,
                currency: account.currency,
                address: account.address
            }
            console.log(obj)
            serializedClients.push(obj);
        }

        res.status(200).send({status: true, accounts: serializedClients});

    }catch (e) {
        next(e)
    }
}
exports.getTotalSupplyByClient = async(req, res,next) => {
    try {
        const clientId = req.params.client;

        const client= await Client.findOne({
            where: {
                extId: clientId
            }
        })
        if (!client) {
            throw new NotFound('Client not found');
        }
        const accounts= await  client.getAccounts()

        let response=[];
        for (let account of accounts) {
            const currencyId = getCurrencyId(account.currency)

            var contract = tokenContracts[currencyId-1];

            let balance=  await contract.methods.totalSupply().call();

            let obj= {
                balance: balance ? web3.utils.fromWei(balance.toString(), "ether"): 0,
                currency: account.currency
            }
            response.push(obj);
        }

        res.status(200).send({status: true, coins: response});

    }catch (e) {
        next(e)
    }
}

exports.getAllowed = async(req,res,next) => {

    const coin=req.params.coin;
    try {
        if (!coin) {
            throw new BadRequest('Coin is required');
        }
        const address = req.params.address;

        const account= await Account.findOne({
            where: {
                address: address
            }
        })

        if (!account) {
            throw new NotFound('Account not found');
        }

        const currencyId = getCurrencyId(coin)
        var contract = tokenContracts[currencyId-1];


        let allowed=   await  contract.methods.allowance(process.env.UNLOCK_ACCOUNT,address ).call()

        res.status(200).send({status: true, allowed: parseFloat(allowed ? allowed: 0)});

    }catch (e) {
        next(e)
    }
}

exports.setAllowed = async(req,res,next) => {

    const coin=req.params.coin;
    const body=req.body;

    const amount = body.amount;
    try {
        if (!coin) {
            throw new BadRequest('Coin is required');
        }
        const address = req.params.address;

        const account= await Account.findOne({
            where: {
                address: address
            }
        })

        if (!account) {
            throw new NotFound('Account not found');
        }

        const currencyId = getCurrencyId(coin)
        var contract = tokenContracts[currencyId-1];


        await contract.methods.approve(address.toLowerCase(), amount ).send({
            from:  process.env.UNLOCK_ACCOUNT
        })

        let allowed=   await  contract.methods.allowance(process.env.UNLOCK_ACCOUNT,address ).call()

        res.status(200).send({status: true, allowed: parseFloat(allowed ? allowed: 0)});

    }catch (e) {
        next(e)
    }
}


//test
exports.createAccounttest = async(req, res,next) => {
    try{
        var body=req.body;
        const password= body.password;
        const	mnemonic = bip39.generateMnemonic(128);
        const	seed = await bip39.mnemonicToSeed(mnemonic,password);

        const	master = hdkey.fromMasterSeed(seed);
        const   account = master.derivePath("m/44'/60'/0'");

        const addrT= account.deriveChild(0).deriveChild(0);
        console.log(addrT.privateExtendedKey())
        console.log('-------------------------')
        console.log(addrT.getWallet().getPrivateKeyString())
        console.log(addrT.getWallet().getAddressString())
        console.log('-------------------------')

        const encrypted = encrypt(addrT.privateExtendedKey(), password);
        console.log('ENCRYPTED')
        console.log(encrypted);
        console.log('-------------------------')
        const test = decrypt(encrypted, password+"1");
        console.log('DECRYPTED')
        console.log(test);




        // const wallet1 = Wallet.fromPrivateKey(ethUtil.toBuffer(addrT.getWallet().getPrivateKeyString()));
        // const publicKey = wallet1.getPublicKeyString();
        // console.log(publicKey);
        // const address = wallet1.getAddressString();
        // console.log(address);
//         const privateKeyBuffer = ethUtil.toBuffer(addrT.privateExtendedKey());
//         const wallet = jswallet.fromPrivateKey(privateKeyBuffer);
//
//
//         const privKey =Buffer.from(addrT.publicExtendedKey(),'hex');
//         const privateKeyBuffer = ethUtil.toBuffer(privKey);
// console.log(privateKeyBuffer)
//         const wallet = Wallet.fromPrivateKey(addrT.publicExtendedKey());
//         console.log(wallet)
        // const encrypted = web3.eth.accounts.encrypt(addrT.publicExtendedKey(),password);
        // console.log('ENCRYPTEd')
        // console.log(encrypted)
        //
        // //
        //     let keyDecrypted=  await web3.eth.accounts.decrypt(encrypted, password);
        //     console.log('DECRYPTEd')
        // console.log(keyDecrypted)
        //     console.log(keyDecrypted.address)
        //
        //
        //
        //     const	master2 = hdkey.fromExtendedKey(addrT.getWallet().getPrivateKeyString());
        //     const childKey = master2.deriveChild(0).deriveChild(1);
        //     const address = childKey.getWallet().getAddressString();
        //     console.log(address)


        res.status(200).send({"ok": true});
    }catch (e) {
        next(e)
    }
}

