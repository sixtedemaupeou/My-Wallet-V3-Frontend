angular
  .module('walletApp')
  .controller('SendBitcoinCashController', SendBitcoinCashController);

function SendBitcoinCashController ($rootScope, $scope, AngularHelper, Env, MyWallet, Wallet, Alerts, currency, format, BitcoinCash) {
  let feePerByte;
  let enumify = (...ns) => ns.reduce((e, n, i) => angular.merge(e, {[n]: i}), {});

  $scope.transaction = {
    amount: null
  };

  $scope.steps = enumify('send-cash', 'send-confirm');
  $scope.onStep = (s) => $scope.steps[s] === $scope.step;
  $scope.goTo = (s) => $scope.step = $scope.steps[s];
  $scope.goTo('send-cash');

  $scope.forms = {};
  $scope.originsLoaded = true;
  $scope.accounts = BitcoinCash.accounts.filter((a) => !a.archived);
  $scope.origins = $scope.accounts.concat(MyWallet.wallet.bch.importedAddresses);
  $scope.transaction.from = MyWallet.wallet.bch.defaultAccount;

  $scope.toSatoshi = currency.convertToSatoshi;
  $scope.fromSatoshi = currency.convertFromSatoshi;
  $scope.bchCurrency = currency.bchCurrencies[0];
  $scope.fiatCurrency = Wallet.settings.currency;
  $scope.isValidAddress = Wallet.isValidAddress;

  $scope.onAddressScan = (result) => {
    let address = Wallet.parsePaymentRequest(result, 'bch');
    if (Wallet.isValidAddress(address.address)) {
      $scope.transaction.destination = format.destination(address, 'External')['address'];
    } else {
      throw new Error('BITCOIN_ADDRESS_INVALID');
    }
  };

  const transactionSucceeded = (tx) => {
    $rootScope.scheduleRefresh();
    $scope.free();
    Wallet.beep();
    Alerts.displaySentBitcoin('BITCOIN_CASH_SENT');
    $scope.vm.close();
  };

  const transactionFailed = (error) => {
    Alerts.displayError(error.error || error.message);
  };

  $scope.numberOfActiveAccountsAndLegacyAddresses = () => {
    let numAccts = BitcoinCash.accounts.filter(a => !a.archived).length;
    let numAddrs = MyWallet.wallet.bch.importedAddresses ? MyWallet.wallet.bch.importedAddresses.addresses.length : 0;
    return numAccts + numAddrs;
  };

  $scope.send = () => {
    let addr;
    let tx = $scope.transaction;
    let payment = $scope.transaction.from.createPayment();

    if (isNaN(tx.destination.index)) addr = tx.destination.address;
    else addr = BitcoinCash.accounts[tx.destination.index].receiveAddress;

    $scope.lock();

    payment.to(addr);
    payment.amount(tx.amount);
    payment.feePerByte(feePerByte);
    payment.build();

    const signAndPublish = (passphrase) => {
      return payment.sign(passphrase).publish();
    };

    Wallet.askForSecondPasswordIfNeeded().then(signAndPublish)
      .then(transactionSucceeded).catch(transactionFailed);
  };

  $scope.getTransactionTotal = (includeFee) => {
    let tx = $scope.transaction;
    let fee = includeFee ? tx.fee : 0;
    return parseInt(tx.amount, 10) + parseInt(fee, 10);
  };

  $scope.useAll = () => {
    $scope.transaction.amount = $scope.transaction.maxAvailable;
  };

  Env.then((res) => {
    feePerByte = res.bcash.feePerByte;

    $scope.setMax = () => {
      $scope.transaction.from.getAvailableBalance(feePerByte).then((balance) => {
        $scope.transaction.fee = balance.sweepFee;
        $scope.transaction.maxAvailable = balance.amount;
      }).catch((err) => {
        console.log(err);
        $scope.transaction.maxAvailable = 0;
      });
    };

    $scope.$watch('transaction.from', $scope.setMax);
  });

  $scope.$watch('transaction.destination', (destination) => {
    if (destination == null) return;
    let valid = destination.index == null ? Wallet.isValidAddress(destination.address) : true;
    $scope.forms.sendForm.destination.$setValidity('isValidAddress', valid);
  }, true);

  AngularHelper.installLock.call($scope);
}
