var express = require('express');
const { authJwt } = require("../middleware");
const {NotFound} = require('../helpers/error')
const authController = require("../controllers/auth.controller");
const accountController = require("../controllers/account.controller");
const transactionController = require("../controllers/transaction.controller");
const bitgoController = require("../controllers/bitgo.controller");
var {requestHandler} = require('../helpers/requestHandler')
var {doRequest} = require("../services/CoinBackService");

const router = express.Router();


router.post("/auth/login", authController.login);

//Accounts
router.post("/account",[authJwt.verifyToken], accountController.createAccount);
router.patch("/account/:client",[authJwt.verifyToken], accountController.openAccount);
router.get("/account/:address/:coin",[authJwt.verifyToken], accountController.getAccount);
router.get("/accounts/:client",[authJwt.verifyToken], accountController.getAccountsByClient);
router.get("/coins/:client",[authJwt.verifyToken], accountController.getTotalSupplyByClient);
router.get("/allowed/:address/:coin",[authJwt.verifyToken], accountController.getAllowed);
router.post("/allowed/:address/:coin",[authJwt.verifyToken], accountController.setAllowed);

//Transactions
router.post("/mint",[authJwt.verifyToken], transactionController.mint);
router.post("/transfer",[authJwt.verifyToken], transactionController.transfer);
router.get("/transaction/:txHash/:txId",[authJwt.verifyToken], transactionController.getTransaction);

//bitgo
router.post("/bitgo/wallet",[authJwt.verifyToken], bitgoController.createWallet);
router.post("/bitgo/address",[authJwt.verifyToken], bitgoController.createAddress);
router.post("/bitgo/transfer",[authJwt.verifyToken], bitgoController.sendTransfer);
router.get("/bitgo/balance/:coin/:address",[authJwt.verifyToken], bitgoController.getAddressBalance);
router.get("/bitgo/transfer/:coin/:transferId",[authJwt.verifyToken], bitgoController.getTransfer);


//Route not match
router.use(function (req, res, next) {
    throw new NotFound('Not Found');
});

module.exports = { router };
