const {unlockAccount, signTransaction, estimateGas, converter} = require('../helpers/security')
const Web3PromiEvent = require("web3-core-promievent");

const web3 = require('../helpers/web3')
const {BadRequest, NotFound, ApiError} = require('../helpers/error')
const {getCurrencyId} = require('../helpers/currency')
const {config} = require('../helpers/config')
const {tokenContracts} = require('../helpers/getContracts');
const {TRANSACTION_STATUS} = require('../helpers/transactionStatus')
const db = require("../models");
const Transaction = db.transaction;
const Account = db.account;

exports.mint = async (req, res, next) => {
    var body = req.body;
    try {
        if (!body.coin) {
            throw new BadRequest('Coin is required');
        }
        if (!body.accounts || !body.amounts) {
            throw new BadRequest('Missing params');
        }
        if (body.accounts.length !== body.amounts.length) {
            throw new BadRequest('Accounts and Amount length mismatch');
        }
        const coin = body.coin
        const extTransactionId = body.txId
        const accounts = body.accounts;
        const amounts = body.amounts;
        const currencyId = getCurrencyId(coin)
        const contract = tokenContracts[currencyId - 1];

        const newAmounts = []
        for (var i = 0; i < amounts.length; i++) {
            newAmounts.push(converter(amounts[i]))
        }

        let account = await Account.findOne({
            where: {
                address: accounts[0] ? accounts[0] : ''
            }
        })
        if (!account) {
            throw new NotFound('Client not found');
        }
        unlockAccount();

        let status = true;
        let data = await new Promise((resolve, reject) => {
            contract.methods.mint(accounts, newAmounts).send({
                from: process.env.UNLOCK_ACCOUNT
            }).on("transactionHash", async tx => {
                await Transaction.create({
                    currency: coin,
                    data: JSON.stringify(body.accounts),
                    type: 'mint',
                    fee: 0,
                    txHash: tx,
                    status: TRANSACTION_STATUS.PENDING,
                    amount: amounts[0],
                    extTxId: extTransactionId,
                    clientId: account.clientId
                });
                console.log(tx)
                resolve(tx);
            }).on("receipt", async receipt => {
                console.log('receipt')
                console.log(receipt)
                status = false;
                Transaction.update({
                    status: receipt.status === true
                        ? TRANSACTION_STATUS.CONFIRMED
                        : TRANSACTION_STATUS.REVERTED
                }, {
                    where: {txHash: receipt.transactionHash}
                }).then(results => {
                    if (results.length === 0) {
                        throw new ApiError('Problem updating transaction', results);
                    }
                })
                resolve(receipt.transactionHash);
            }).on("error", (errorReceipt) => {
                status = false;
                resolve('');
            });
        });
        res.status(200).send({
            status: true,
            transactionHash: data
        });
    } catch (e) {
        next(e)
    }
}

exports.transfer = async (req, res, next) => {
    var body = req.body;
    try {
        let promiEvent = Web3PromiEvent();
        const from = body.from;
        const to = body.to;
        let amount = body.amount;
        const fee = body.fee;
        const coin = body.coin;
        const password = body.password;
        const extTransactionId = body.txId
        const nonce = Date.now();

        if (!from || !to || !coin || !password || !amount) {
            throw new BadRequest('Missing params');
        }

        const account = await Account.findOne({
            where: {
                address: from,
                currency: coin
            }
        })

        if (!account) {
            throw new NotFound('Account not found');
        }


        let keyDecrypted = await web3.eth.accounts.decrypt(account.privateKey, password);


        if (!keyDecrypted || !keyDecrypted.privateKey) {
            throw new ApiError('Invalid Password');
        }

        const currencyId = getCurrencyId(coin)

        const addressContract = config.acceptedTokens[currencyId - 1].address;

        const amountConverted = converter(amount);
        let payload = {
            from: from,
            to: to,
            amount: amountConverted,
            fee: fee,
            nonce: nonce,
            addressContract: addressContract,
            privateKey: keyDecrypted.privateKey
        }

        //Sign Transaction
        const signature = await signTransaction(payload);


        const contract = tokenContracts[currencyId - 1];

        unlockAccount();
        //Check Allowance to see if call Approve first
        let allowed = await contract.methods.allowance(process.env.UNLOCK_ACCOUNT, from.toString()).call()
        const prices = await estimateGas();
        console.log(prices)
        const amountAllowed = allowed ? parseFloat(web3.utils.fromWei(allowed.toString())) : 0;
        if (amount <= amountAllowed) {
            //Do Transaction
            doTransaction(contract, account, coin, from, to, amountConverted, fee, extTransactionId, nonce, signature, promiEvent);
        } else {
            const gasPrice = await web3.eth.getGasPrice();
            console.log('gasprice')
            console.log(gasPrice)
            const wei= web3.utils.toWei(prices.high.toString(),'gwei')
            console.log('wei')
            console.log(wei)


            //Approve Transaction and Amount to spend
            contract.methods.approve(payload.from.toLowerCase(), payload.amount).send({
                from: process.env.UNLOCK_ACCOUNT,
                gasPrice: wei
            }).then(res => {
                //Do Transaction
                doTransaction(contract, account, coin, from, to, amountConverted, fee, extTransactionId, nonce, signature, promiEvent);
            })
        }


        let status = true;

        res.status(200).send({
            status: status,
            transactionHash: ''
        });
        return promiEvent.eventEmitter;
    } catch (e) {
        console.log(e)
        next(e)
    }
}


const doTransaction = async (contract, account, coin, from, to, amount, fee, extTransactionId, nonce, signature, promiEvent) => {
    try {
        const saveData = {
            from, to, fee, amount, coin, extTransactionId
        }

        let status = true;
        const unlockAcc = process.env.UNLOCK_ACCOUNT;
        const gasPrice = await web3.eth.getGasPrice();
        const prices = await estimateGas();
        console.log(prices)
        console.log('gasprice')
        console.log(gasPrice)
       const wei= web3.utils.toWei(prices.high.toString(),'gwei')
        console.log('wei')
        console.log(wei)
        contract.methods.transferPreSigned(signature, from.toString(), to.toString(), amount, fee.toString(), nonce.toString()
        ).send({
            from: unlockAcc.toLowerCase(),
            gasPrice: wei
        }).on("transactionHash", async tx => {
            await Transaction.create({
                currency: coin,
                data: JSON.stringify(saveData),
                type: 'transfer',
                fee: fee,
                from: from,
                to: to,
                txHash: tx,
                extTxId: extTransactionId,
                status: TRANSACTION_STATUS.PENDING,
                amount: amount,
                clientId: account.clientId
            });
            promiEvent.eventEmitter.emit("transactionHash", tx);
            promiEvent.resolve(tx);
        }).on("receipt", async receipt => {
            console.log('Receipt Response')
            console.log(receipt)
            status = false;
            Transaction.update({
                status: receipt.status === true
                    ? TRANSACTION_STATUS.CONFIRMED
                    : TRANSACTION_STATUS.REVERTED
            }, {
                where: {txHash: receipt.transactionHash}
            }).then(results => {
                if (results.length === 0) {
                    throw new ApiError('Problem updating transaction', results);
                }
            })
            promiEvent.eventEmitter.emit("receipt", {
                receipt,
                status: true
            });
        }).on("error", (errorReceipt) => {
            console.log("Fatal error")
            console.log(errorReceipt)
            const errorObj = JSON.parse(
                errorReceipt.message.substring(
                    "Transaction has been reverted by the EVM:\\n".length - 1
                )
            );
            Transaction.update({
                status: TRANSACTION_STATUS.ERROR
            }, {
                where: {txHash: errorObj.transactionHash}
            }).then(results => {
                if (results.length === 0) {
                    throw new ApiError('Problem updating transaction', results);
                }
            })
            status = false;
            promiEvent.eventEmitter.emit("error", {
                errorReceipt,
                status: false
            });
        });

    } catch (e) {
        console.log(e)
    }
}

exports.getTransaction = async (req, res, next) => {
    try {
        const txHash = req.params.txHash;
        const extId = req.params.txId;
        if (!txHash) {
            throw new BadRequest('Transaction hash is required');
        }
        let transaction = await Transaction.findOne({
            where: {
                extTxId: txHash
            }
        });

        if (!transaction && extId) {
            transaction = await Transaction.findOne({
                where: {
                    extTxId: extId
                }
            });
        }
        if (!transaction) {
            throw new NotFound('Transaction not found');
        }
        res.status(200).send(
            {
                status: true,
                transactionHash: transaction.txHash,
                transactionStatus: transaction.status
            });


    } catch (e) {
        console.log(e)
        next(e)
    }
}
