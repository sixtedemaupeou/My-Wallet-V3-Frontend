function valueToBigInt(valueBuffer) {
    if (valueBuffer instanceof Bitcoin.BigInteger) return valueBuffer;

    // Prepend zero byte to prevent interpretation as negative integer
    //return Bitcoin.BigInteger.fromByteArrayUnsigned(valueBuffer);
    return new Bitcoin.BigInteger.fromByteArrayUnsigned(valueBuffer);
}

function formatValueBitcoin(valueBuffer) {
    var value = valueToBigInt(valueBuffer).toString();
    var integerPart = value.length > 8 ? value.substr(0, value.length-8) : '0';
    var decimalPart = value.length > 8 ? value.substr(value.length-8) : value;
    while (decimalPart.length < 8) decimalPart = "0"+decimalPart;
    decimalPart = decimalPart.replace(/0*$/, '');
    while (decimalPart.length < 2) decimalPart += "0";
    return integerPart+"."+decimalPart;
}

function parseValueBitcoin(valueString) {
    var valueString = valueString.toString();
    // TODO: Detect other number formats (e.g. comma as decimal separator)
    var valueComp = valueString.split('.');
    var integralPart = valueComp[0];
    var fractionalPart = valueComp[1] || "0";
    while (fractionalPart.length < 8) fractionalPart += "0";
    fractionalPart = fractionalPart.replace(/^0+/g, '');
    var value = Bitcoin.BigInteger.valueOf(parseInt(integralPart));
    value = value.multiply(Bitcoin.BigInteger.valueOf(100000000));
    value = value.add(Bitcoin.BigInteger.valueOf(parseInt(fractionalPart)));
    return value;
}

//------
//Should find somewhere else for these
//user precision (e.g. BTC or mBTC) to satoshi big int
function precisionToSatoshiBN(x) {
    return parseValueBitcoin(x).divide(Bitcoin.BigInteger.valueOf(Math.pow(10, sShift(symbol_btc)).toString()));
}

//user precision (e.g. 0.02 BTC or 0.02 mBTC) to BTC decimal
function precisionToBTC(x) {
    return formatValueBitcoin(precisionToSatoshiBN(x));
}

//Satoshi BN to precision decimal
function precisionFromSatoshi(x) {
    return formatValueBitcoin(x.multiply(Bitcoin.BigInteger.valueOf(Math.pow(10, sShift(symbol_btc)))));
}

//BTC decimal to user precision (e.g. BdeleteAddressTC or mBTC)
function precisionFromBTC(x) {
    return precisionFromSatoshi(parseValueBitcoin(x));
}

//user precision to display string
function formatPrecision(x) {
    return formatBTC(precisionToSatoshiBN(x).toString());
}
//-----

var MyWallet = new function() {
    var MyWallet = this;

    var languageCodeToLanguage = {
      "de": "German",
      "hi": "Hindi",
      "no": "Norwegian",
      "ru": "Russian",
      "pt": "Portuguese",
      "bg": "Bulgarian",
      "fr": "French",
      "zh-cn": "Chinese Simplified",
      "hu": "Hungarian",
      "sl": "Slovenian",
      "id": "Indonesian",
      "sv": "Swedish",
      "ko": "Korean",
      "el": "Greek",
      "en": "English",
      "it": "Italiano",
      "es": "Spanish",
      "vi": "Vietnam",
      "th": "Thai",
      "ja": "Japanese",
      "pl": "Polski",
      "da": "Danish",
      "ro": "Romanian",
      "nl": "Dutch",
      "tr": "Turkish"
    };
    var currencyCodeToCurrency = {
      "ISK" : "lcelandic Króna",
      "HKD" : "Hong Kong Dollar",
      "TWD" : "New Taiwan dollar",
      "CHF" : "Swiss Franc",
      "EUR" : "Euro",
      "DKK" : "Danish Krone",
      "CLP" : "Chilean, Peso",
      "USD" : "U.S. dollar",
      "CAD" : "Canadian Dollar",
      "CNY" : "Chinese yuan",
      "THB" : "Thai baht",
      "AUD" : "Australian Dollar",
      "SGD" : "Singapore Dollar",
      "KRW" : "South Korean Won",
      "JPY" : "Japanese Yen",
      "PLN" : "Polish Zloty",
      "GBP" : "Great British Pound",
      "SEK" : "Swedish Krona",
      "NZD" : "New Zealand Dollar",
      "BRL" : "Brazil Real",
      "RUB" : "Russian Ruble"
    };

    this.skip_init = false; //Set on sign up page
    var demo_guid = 'abcaa314-6f67-6705-b384-5d47fbe9d7cc';
    var encrypted_wallet_data; //Encrypted wallet data (Base64, AES 256)
    var guid; //Wallet identifier
    var cVisible; //currently visible view
    var password; //Password
    var dpassword; //double encryption Password
    var dpasswordhash; //double encryption Password
    var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't overwrite a wallet backup even if you have the guid
    var final_balance = 0; //Final Satoshi wallet balance
    var total_sent = 0; //Total Satoshi sent
    var total_received = 0; //Total Satoshi received
    var n_tx = 0; //Number of transactions
    var n_tx_filtered = 0; //Number of transactions after filtering
    var latest_block; //Chain head block
    var address_book = {}; //Holds the address book addr = label
    var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
    var double_encryption = false; //If wallet has a second password
    var tx_page = 0; //Multi-address page
    var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)
    var maxAddr = 1000; //Maximum number of addresses
    var addresses = {}; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
    var payload_checksum; //SHA256 hash of the current wallet.aes.json
    var archTimer; //Delayed Backup wallet timer
    var mixer_fee = 0.5; //Default mixer fee 1.5%
    var recommend_include_fee = true; //Number of unconfirmed transactions in blockchain.info's memory pool
    var default_pbkdf2_iterations = 10; //Not ideal, but limitations of using javascript
    var main_pbkdf2_iterations = default_pbkdf2_iterations; //The number of pbkdf2 iterations used for the main password
    var tx_notes = {}; //A map of transaction notes, hash -> note
    var auth_type; //The two factor authentication type used. 0 for none.
    var real_auth_type = 0; //The real two factor authentication. Even if there is a problem with the current one (for example error 2FA sending email).
    var logout_timeout; //setTimeout return value for the automatic logout
    var event_listeners = []; //Emits Did decrypt wallet event (used on claim page)
    var monitor_listeners = []; //success, errors, notices
    var last_input_main_password; //The time the last password was entered
    var main_password_timeout = 60000;
    var isInitialized = false;
    var language = 'en'; //Current language
    var localSymbolCode = null; //Current local symbol
    var supported_encryption_version = 2.0;  //The maxmimum supported encryption version
    var encryption_version_used = 0.0; //The encryption version of the current wallet. Set by decryptWallet()
    var serverTimeOffset = 0; //Difference between server and client time
    var haveSetServerTime = false; //Whether or not we have synced with server time
    var sharedcoin_endpoint; //The URL to the sharedcoin node
    var disable_logout = false;
    var haveBoundReady = false;
    var isRestoringWallet = false;
    var sync_pubkeys = false;

    var BigInteger = Bitcoin.BigInteger;
    var ECKey = Bitcoin.ECKey;
    var buffer = Bitcoin.Buffer;

    var myHDWallet = null;
    var isSynchronizedWithServer = true;
    var localWalletJsonString = null;
    var haveBuildHDWallet = false;
    var tx_tags = {};
    var tag_names = [];
    var paidTo = {};
    var paidToAddressesToBalance = {};
    var mnemonicVerified = false;
    var defaultAccountIdx = 0;
    var didSetGuid = false;
    var amountToRecommendedFee = {};
    var isAccountRecommendedFeesValid = true;
    var api_code = "0";
    var counter = 0;
    var isPolling = false;

    var wallet_options = {
        pbkdf2_iterations : default_pbkdf2_iterations, //Number of pbkdf2 iterations to default to for second password and dpasswordhash
        fee_policy : 0,  //Default Fee policy (-1 Tight, 0 Normal, 1 High)
        html5_notifications : false, //HTML 5 Desktop notifications
        logout_time : 600000, //Default 10 minutes
        tx_display : 0, //Compact or detailed transactions
        always_keep_local_backup : false, //Whether to always keep a backup in localStorage regardless of two factor authentication
        transactions_per_page : 30, //Number of transactions per page
        additional_seeds : []
    };

    this.setAPICode = function(val) {
        api_code = val;
    }

    this.getAPICode = function() {
        return api_code;
    }

    this.setEncryptedWalletData = function(data) {
        if (!data || data.length == 0) {
            encrypted_wallet_data = null;
            payload_checksum = null;
            return;
        }

        encrypted_wallet_data = data;

        //Generate a new Checksum
        payload_checksum = generatePayloadChecksum();

        try {
            //Save Payload when two factor authentication is disabled
            if (real_auth_type == 0 || wallet_options.always_keep_local_backup)
                MyStore.put('payload', encrypted_wallet_data);
            else
                MyStore.remove('payload');
        } catch (e) {
            console.log(e);
        }
    }

    this.didVerifyMnemonic = function() {
        mnemonicVerified = true;
        MyWallet.backupWalletDelayed();
    }

    this.isMnemonicVerified = function() {
        return mnemonicVerified;
    }

    this.setDefaultAccountIndex = function(accountIdx) {
        defaultAccountIdx = accountIdx;
        MyWallet.backupWalletDelayed();
    }

    this.getDefaultAccountIndex = function() {
        return defaultAccountIdx;
    }

    this.isSynchronizedWithServer = function() {
        return isSynchronizedWithServer;
    }

    this.setRealAuthType = function(val) {
        real_auth_type = val;
    }

    this.get2FAType = function() {
        return real_auth_type;
    }

    this.get2FATypeString = function() {
        if (real_auth_type == 0) {
            return null;
        } else if (real_auth_type == 1) {
            return 'Yubikey';
        } else if (real_auth_type == 2) {
            return 'Email';
        } else if (real_auth_type == 3) {
            return 'Yubikey MtGox';

        } else if (real_auth_type == 4) {
            return 'Google Auth';
        } else if (real_auth_type == 5) {
            return 'SMS';
        }
    }

    this.addAdditionalSeeds = function(val) {
        wallet_options.additional_seeds.push(val);
    }

    this.getAdditionalSeeds = function(val) {
        return wallet_options.additional_seeds;
    }

    this.getLanguage = function() {
        if (language) {
            return language;
        } else {
            return MyStore.get('language');            
        }
    }

    this.setLanguage = function(_language) {
        MyStore.put('language', _language);
        language = _language;
    }

    this.getLocalSymbolCode = function() {
        if (localSymbolCode) {
            return localSymbolCode;
        } else {
            return MyStore.get('localSymbolCode');            
        }
    }

    this.setLocalSymbolCode = function(code) {
        MyStore.put('localSymbolCode', code);
        symbol_local.code = code;
        localSymbolCode = code;
    }

    this.getLanguages = function() {
        return languageCodeToLanguage;
    }

    this.getCurrencies = function() {
        return currencyCodeToCurrency;
    }

    this.addEventListener = function(func) {
        event_listeners.push(func);
    }

    this.sendEvent = function(event_name, obj) {
        for (var listener in event_listeners) {
            event_listeners[listener](event_name, obj)
        }
    }

    this.monitor = function(func) {
        monitor_listeners.push(func);
    }

    this.sendMonitorEvent = function(obj) {
        for (var listener in monitor_listeners) {
            monitor_listeners[listener](obj)
        }
    }

    this.getLogoutTime = function() {
        return wallet_options.logout_time;
    }

    this.getSecondPasswordPbkdf2Iterations = function() {
        return wallet_options.pbkdf2_iterations;
    }

    this.getMainPasswordPbkdf2Iterations = function() {
        return main_pbkdf2_iterations;
    }

    this.getDefaultPbkdf2Iterations = function() {
        return default_pbkdf2_iterations;
    }

    this.getSharedKey = function() {
        return sharedKey;
    }

    this.getSharedcoinEndpoint = function() {
        return sharedcoin_endpoint;
    }

    this.disableLogout = function(value) {
        disable_logout = value;
    }

    this.getFinalBalance = function() {
        return final_balance;
    }

    this.getTotalSent = function() {
        return total_sent;
    }

    this.getTotalReceived = function() {
        return total_received;
    }

    this.setLogoutTime = function(logout_time) {
        wallet_options.logout_time = logout_time;

        clearInterval(logout_timeout);

        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
    }

    this.getDoubleEncryption = function() {
        return double_encryption;
    }

    this.getEncryptedWalletData = function() {
        return encrypted_wallet_data;
    }

    this.getFeePolicy = function() {
        return wallet_options.fee_policy;
    }

    this.setFeePolicy = function(policy) {
        if (policy != -1 && policy != 0 && policy != 1)
            throw 'Invalid fee policy';

        wallet_options.fee_policy = parseInt(policy);

        //Fee Policy is stored in wallet so must save it
        MyWallet.backupWallet('update', function() {
            if (successCallback)
                successCallback(response);
        }, function() {
            if (errorCallback)
                errorCallback();
        });
    }

    this.setAlwaysKeepLocalBackup = function(val) {
        wallet_options.always_keep_local_backup = val;
    }

    this.getAlwaysKeepLocalBackup = function() {
        return wallet_options.always_keep_local_backup;
    }

    this.setNTransactionsPerPage = function(val) {
        wallet_options.transactions_per_page = val;
    }

    this.getNTransactionsPerPage = function() {
        return wallet_options.transactions_per_page;
    }

    this.getGuid = function() {
        return guid;
    }

    this.getHTML5Notifications = function() {
        return wallet_options.html5_notifications;
    }

    this.setHTML5Notifications = function(val) {
        wallet_options.html5_notifications = val;
    }

    this.getNTransactions = function() {
        return n_tx;
    }

    this.getTransactions = function() {
        return transactions;
    }
    
    this.legacyAddressExists = function(address) {
        return addresses[address] != null;
    }

    this.getLegacyAddressTag = function(address) {
        return addresses[address].tag;
    }

    this.setLegacyAddressTag = function(address, tag) {
        addresses[address].tag = tag;
    }

    this.getAddressBook = function() {
        return address_book;
    }

    this.getLegacyAddressLabel = function(address) {
        if (addresses[address])
            return addresses[address].label;
        else
            return null;
    }

    this.setLegacyAddressBalance = function(address, balance) {
        addresses[address].balance = balance;
    }

    this.getAddressBookLabel = function(address) {
        return address_book[address];
    }

    this.isActiveLegacyAddress = function(addr) {
        return addresses[addr] != null && addresses[addr].tag != 2;
    }

    this.isWatchOnlyLegacyAddress = function(address) {
        return !addresses[address] || addresses[address].priv == null;
    }

    this.getLegacyAddressBalance = function(address) {
        return addresses[address].balance;
    }

    this.getTotalBalanceForActiveLegacyAddresses = function() {
        var totalBalance = 0;
        for (var key in addresses) {
            var addr = addresses[key];
            if (addr.tag != 2)
                totalBalance += addr.balance;
        }
        return totalBalance;
    }

    this.getMixerFee = function() {
        return mixer_fee;
    }

    this.getRecommendIncludeFee = function() {
        return recommend_include_fee;
    }

    this.deleteLegacyAddress = function(addr) {
        delete addresses[addr];
        MyWallet.backupWalletDelayed();
    }

    this.addAddressBookEntry = function(addr, label) {
        address_book[addr] = label;
    }

    //TODO Depreciate this. Need to restructure signer.js
    this.getPrivateKey = function(address) {
        return addresses[address].priv;
    }

    this.setLegacyAddressLabel = function(address, label) {
        addresses[address].label = label;

        MyWallet.backupWalletDelayed();
    }

    this.securePost = function(url, data, success, error) {
        var clone = jQuery.extend({}, data);

        if (!data.sharedKey) {
            if (!sharedKey || sharedKey.length == 0 || sharedKey.length != 36) {
                throw 'Shared key is invalid';
            }

            //Rather than sending the shared key plain text
            //send a hash using a totp scheme
            var now = new Date().getTime();
            var timestamp = parseInt((now - serverTimeOffset) / 10000);

            var SKHashHex = CryptoJS.SHA256(sharedKey.toLowerCase() + timestamp).toString();

            var i = 0;
            var tSKUID = SKHashHex.substring(i, i+=8)+'-'+SKHashHex.substring(i, i+=4)+'-'+SKHashHex.substring(i, i+=4)+'-'+SKHashHex.substring(i, i+=4)+'-'+SKHashHex.substring(i, i+=12);

            clone.sharedKey = tSKUID;
            clone.sKTimestamp = timestamp;
            clone.sKDebugHexHash = SKHashHex;
            clone.sKDebugTimeOffset = serverTimeOffset;
            clone.sKDebugOriginalClientTime = now;
            clone.sKDebugOriginalSharedKey = sharedKey; //Debugging only needs removing ASAP
        }

        if (!data.guid)
            clone.guid = guid;

        clone.format =  data.format ? data.format : 'plain'
        clone.api_code = MyWallet.getAPICode();

        var dataType = 'text';
        if (data.format == 'json')
            dataType = 'json';

        $.ajax({
            dataType: dataType,
            type: "POST",
            timeout: 60000,
            url: BlockchainAPI.getRootURL() + url,
            data : clone,
            success: success,
            error : error
        });
    }

    this.isCorrectMainPassword = function(_password) {
        return password == _password;
    }

    function hashPassword(password, iterations) {
        //N rounds of SHA 256
        var round_data = CryptoJS.SHA256(password);
        for (var i = 1; i < iterations; ++i) {
            round_data = CryptoJS.SHA256(round_data);
        }
        return round_data.toString();
    }

    this.setPbkdf2Iterations = function(pbkdf2_iterations, success) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            window.location.reload();
        };

        MyWallet.getSecondPassword(function() {
            try {
                //If double encryption is enabled we need to rencrypt all keys
                if (double_encryption) {
                    //Rencrypt all keys
                    for (var key in addresses) {
                        var addr = addresses[key];

                        if (addr.priv) {
                            addr.priv = MyWallet.encrypt(MyWallet.decryptPK(addr.priv), sharedKey + dpassword, pbkdf2_iterations);

                            if (!addr.priv) throw 'addr.priv is null';
                        }
                    }

                    //Set the second password iterations
                    wallet_options.pbkdf2_iterations = pbkdf2_iterations;

                    //Generate a new password hash
                    dpasswordhash = hashPassword(sharedKey + dpassword, pbkdf2_iterations);
                }

                //Must use new encryption format
                encryption_version_used = 2.0;

                //Set the main password pbkdf2 iterations
                main_pbkdf2_iterations = pbkdf2_iterations;

                MyWallet.backupWallet('update', function() {
                    success();
                }, function() {
                    panic(e);
                });

            } catch (e) {
                panic(e);
            }
        }, function (e) {
            panic(e);
        });
    }

    this.B58LegacyDecode = function(input) {
        var alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        var base = BigInteger.valueOf(58);

        var bi = BigInteger.valueOf(0);
        var leadingZerosNum = 0;
        for (var i = input.length - 1; i >= 0; i--) {
            var alphaIndex = alphabet.indexOf(input[i]);

            bi = bi.add(BigInteger.valueOf(alphaIndex)
                .multiply(base.pow(input.length - 1 -i)));

            // This counts leading zero bytes
            if (input[i] == "1") leadingZerosNum++;
            else leadingZerosNum = 0;
        }
        var bytes = bi.toByteArrayUnsigned();

        // Add leading zeros
        while (leadingZerosNum-- > 0) bytes.unshift(0);

        return bytes;
    }

    this.unsetSecondPassword = function(success, error) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            window.location.reload();
        };

        try {
            for (var key in addresses) {

                var addr = addresses[key];

                if (addr.priv) {
                    addr.priv = MyWallet.decryptPK(addr.priv);

                    if (!addr.priv) throw 'addr.priv is null';
                }
            }

            for (var i in myHDWallet.getAccounts()) {
                var account = myHDWallet.getAccount(i);
                account.extendedPrivateKey = MyWallet.decryptPK(account.extendedPrivateKey);
            }

            myHDWallet.seedHex = MyWallet.decryptPK(myHDWallet.seedHex);

            double_encryption = false;

            dpassword = null;

            MyWallet.checkAllKeys();

            MyWallet.backupWallet('update', function() {
                success();
            }, function() {
                panic(e);
                error(e);
            });
        } catch (e) {
            panic(e);
            error(e);
        }
    }

    this.setSecondPassword = function(password, success, error) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            window.location.reload();
        };

        try {
            double_encryption = true;
            dpassword = password;

            for (var key in addresses) {
                var addr = addresses[key];

                if (addr.priv) {
                    addr.priv = encodePK(new BigInteger(MyWallet.B58LegacyDecode(addr.priv)));

                    if (!addr.priv) throw 'addr.priv is null';
                }
            }

            for (var i in myHDWallet.getAccounts()) {
                var account = myHDWallet.getAccount(i);
                account.extendedPrivateKey = MyWallet.encryptPK(account.extendedPrivateKey);
            }

            myHDWallet.seedHex = MyWallet.encryptPK(myHDWallet.seedHex);

            dpasswordhash = hashPassword(sharedKey + dpassword, wallet_options.pbkdf2_iterations);

            //Clear the password to force the user to login again
            //Incase they have forgotten their password already
            dpassword = null;

            if (! MyWallet.validateSecondPassword(password)) {
                throw "Invalid Second Password";
            }

            try {
                MyWallet.checkAllKeys();

                MyWallet.backupWallet('update', function() {
                    success();
                }, function(e) {
                    panic(e);
                    error(e);
                });
            } catch(e) {
                panic(e);
                error(e);
            }
        } catch(e) {
            panic(e);
            error(e);
        }
    }

    this.unArchiveLegacyAddr = function(addr) {
        var addr = addresses[addr];
        if (addr.tag == 2) {
            addr.tag = null;


            MyWallet.backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });
        } else {
            MyWallet.sendEvent("msg", {type: "error", message: 'Cannot Unarchive This Address', platform: ""});
        }
    }

    this.archiveLegacyAddr = function(addr) {
        var addr = addresses[addr];
        if (addr.tag == null || addr.tag == 0) {
            addr.tag = 2;


            MyWallet.backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });

        } else {
            MyWallet.sendEvent("msg", {type: "error", message: 'Cannot Archive This Address', platform: ""});
        }
    }
    this.addWatchOnlyLegacyAddress = function(addressString) {
        var address = Bitcoin.Address.fromBase58Check(addressString);

        if (address.toString() != addressString) {
            throw 'Inconsistency between addresses';
        }

        try {
            if (internalAddKey(addressString)) {
                MyWallet.sendEvent("msg", {type: "success", message: 'Successfully Added Address ' + address, platform: ""});

                try {
                    ws.send('{"op":"addr_sub", "addr":"'+addressString+'"}');
                } catch (e) { }

                //Backup
                MyWallet.backupWallet('update', function() {
                    MyWallet.get_history();
                });
            } else {
                throw 'Wallet Full Or Addresses Exists'
            }
        } catch (e) {
            MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""});
        }
    }

    //temperary workaround instead instead of modding bitcoinjs to do it TODO: not efficient
    this.getCompressedAddressString = function(key) {
        return new ECKey(key.d, true).pub.getAddress().toString();
    }
    this.getUnCompressedAddressString = function(key) {
        return new ECKey(key.d, false).pub.getAddress().toString();
    }
    this.getCompressedPubKey = function(key) {
        return new ECKey(key.d, true).pub;
    }
    this.getUncompressedPubKey = function(key) {
        return new ECKey(key.d, false).pub;
    }
    this.getCompressedKey = function(key) {
        return new ECKey(key.d, true);
    }
    this.getUnCompressedAddressString = function(key) {
        return new ECKey(key.d, false).pub.getAddress().toString();
    }

    this.extractAddresses = function(script, addresses) {
        switch (Bitcoin.scripts.classifyOutput(script)) {
        case 'pubkeyhash':
            addresses.push(Bitcoin.Address.fromOutputScript(script));
            return 1;
        case 'pubkey':
            addresses.push(new Bitcoin.Address(Bitcoin.crypto.hash160(script.chunks[0]), Bitcoin.networks.bitcoin.pubKeyHash));
            return 1;
        case 'scripthash':
            //if script output is to a multisig address, classifyOutput will return scripthash
            addresses.push(Bitcoin.Address.fromOutputScript(script));
            return 1;
        case 'multisig':
            for (var i = 1; i < script.chunks.length-2; ++i) {
                addresses.push(new Bitcoin.Address(Bitcoin.crypto.hash160(script.chunks[i]), Bitcoin.networks.bitcoin.pubKeyHash));
            }
            return script.chunks[0] - Bitcoin.opcodes.OP_1 + 1;
        default:
            throw 'Encountered non-standard scriptPubKey';
        }
    }

    this.simpleInPubKeyHash = function(script) {
        switch (Bitcoin.scripts.classifyInput(script)) {
        case 'pubkeyhash':
            return Bitcoin.crypto.hash160(script.chunks[1]);
        case 'pubkey':
          throw new Error("Script does not contain pubkey.");
        default:
          throw new Error("Encountered non-standard scriptSig");
        }
    }

    this.importPrivateKey = function(privateKeyString) {
        var format = MyWallet.detectPrivateKeyFormat(privateKeyString);
        var key = MyWallet.privateKeyStringToKey(privateKeyString, format);
        var compressed = (format == 'sipa') ? false : true;
        
        address = MyWallet.addPrivateKey(key, {compressed: compressed, app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION});
        
        if (address) {

            //Perform a wallet backup
            MyWallet.backupWallet('update', function() {
                MyWallet.get_history();
            });

            // Update balance for this specific address (rather than all wallet addresses):
            // BlockchainAPI.get_balances([address], function() { MyWallet.sendEvent('did_update_legacy_address_balance')  },null)

            MyWallet.sendEvent("msg", {type: "success", message: 'Imported Bitcoin Address ' + key.pub.getAddress().toString(), platform: ""});
            return address
        } else {
            throw 'Unable to add private key for bitcoin address ' + key.pub.getAddress().toString();
        }
    }

    //opts = {compressed, app_name, app_version, created_time}
    this.addPrivateKey = function(key, opts) {
        if (walletIsFull()) {
            throw 'Wallet is full.';
        }

        if (key == null) {
            throw 'Cannot add null key.';
        }

        if (opts == null)
            opts = {};

        var addr = opts.compressed ? MyWallet.getCompressedAddressString(key) : MyWallet.getUnCompressedAddressString(key);

        var encoded = encodePK(key.d);

        if (encoded == null)
            throw 'Error Encoding key';

        var decoded_key = new ECKey(new BigInteger.fromBuffer(MyWallet.decodePK(encoded)), opts.compressed);

        if (addr != MyWallet.getUnCompressedAddressString(key) && addr != MyWallet.getCompressedAddressString(key)) {
            throw 'Decoded Key address does not match generated address';
        }

        if (internalAddKey(addr, encoded)) {
            addresses[addr].tag = 1; //Mark as unsynced
            addresses[addr].created_time = opts.created_time ? opts.created_time : 0; //Stamp With Creation time
            addresses[addr].created_device_name = opts.app_name ? opts.app_name : APP_NAME; //Created Device
            addresses[addr].created_device_version = opts.app_version ? opts.app_version : APP_VERSION; //Created App Version

            if (addresses[addr].priv != encoded)
                throw 'Address priv does not match encoded';

            //Subscribe to transaction updates through websockets
            try {
                ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');
            } catch (e) { }
        } else {
            throw 'Unable to add generated private key.';
        }

        return addr;
    }

    this.generateNewKey = function(_password) {
        var key = Bitcoin.ECKey.makeRandom(false);

        // key is uncompressed, so cannot passed in opts.compressed = true here
        if (MyWallet.addPrivateKey(key)) {
            return key;
        }
    }

    function generateNewMiniPrivateKey() {
        while (true) {
            //Use a normal ECKey to generate random bytes
            var key = Bitcoin.ECKey.makeRandom(false);

            //Make Candidate Mini Key
            var minikey = 'S' + Bitcoin.base58.encode(key.d.toBuffer(32)).substr(0, 21);

            //Append ? & hash it again
            var bytes_appended = Crypto.SHA256(minikey + '?', {asBytes: true});

            //If zero byte then the key is valid
            if (bytes_appended[0] == 0) {

                //SHA256
                var bytes = Crypto.SHA256(minikey, {asBytes: true});

                var eckey = new Bitcoin.ECKey(new Bitcoin.BigInteger.fromBuffer(bytes), false);

                if (MyWallet.addPrivateKey(eckey))
                    return {key : eckey, miniKey : minikey};
            }
        }
    }

    function calcTxResult(tx, is_new, checkCompleted) {
        /* Calculate the result */
        var result = 0;
        for (var i = 0; i < tx.inputs.length; ++i) {
            var output = tx.inputs[i].prev_out;

            if (!output || !output.addr)
                continue;

            //If it is our address then subtract the value
            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result -= value;

                if (is_new) {
                    total_sent += value;
                    addr.balance -= value;
                }
            }

            for (var j = 0; j < myHDWallet.getAccountsCount(); j++) {
                var account = myHDWallet.getAccount(j);
                if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                    tx.account_indexes.push(parseInt(j));
                    result -= parseInt(output.value);
                }
            }

            if (output.addr in paidToAddressesToBalance) {
                paidToAddressesToBalance[output.addr] -= value;
            }
        }

        for (var i = 0; i < tx.out.length; ++i) {
            var output = tx.out[i];

            if (!output || !output.addr)
                continue;

            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result += value;

                if (is_new) {
                    total_received += value;
                    addr.balance += value;
                }
            }

            for (var j = 0; j < myHDWallet.getAccountsCount(); j++) {
                var account = myHDWallet.getAccount(j);
                if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                    tx.account_indexes.push(parseInt(j));
                    result += parseInt(output.value);
                }

                MyWallet.checkToAddTxToPaymentRequestForAccount(account, output.addr, tx.hash, output.value, checkCompleted);
            }

            if (output.addr in paidToAddressesToBalance) {
                paidToAddressesToBalance[output.addr] += value;
            }

        }

        for (var tx_hash in paidTo) {
            if (paidTo[tx_hash].redeemedAt == null &&
                paidToAddressesToBalance[paidTo[tx_hash].address] == 0) {
                paidTo[tx_hash].redeemedAt = tx.time;
                delete paidToAddressesToBalance[paidTo[tx_hash].address];
                MyWallet.sendEvent("paid_to_bitcoins_claimed", {address: paidTo[tx_hash].address});
            }
        }

        return result;
    }

    function generatePayloadChecksum() {        
      return CryptoJS.SHA256(encrypted_wallet_data).toString();        
    }

    function wsSuccess(ws) {
        var last_on_change = null;

        ws.onmessage = function(e) {

            try {
                var obj = $.parseJSON(e.data);

                if (obj.op == 'on_change') {
                    var old_checksum = generatePayloadChecksum();
                    var new_checksum = obj.checksum;

                    console.log('On change old ' + old_checksum + ' ==  new '+ new_checksum);

                    if (last_on_change != new_checksum && old_checksum != new_checksum) {
                        last_on_change = new_checksum;

                        MyWallet.getWallet();
                    }

                } else if (obj.op == 'utx') {
                    isAccountRecommendedFeesValid = false;

                    var tx = TransactionFromJSON(obj.x);

                    //Check if this is a duplicate
                    //Maybe should have a map_prev to check for possible double spends
                    for (var key in transactions) {
                        if (transactions[key].txIndex == tx.txIndex)
                            return;
                    }

                    var result = calcTxResult(tx, true, false);

                    tx.result = result;

                    final_balance += result;

                    n_tx++;

                    tx.setConfirmations(0);

                    transactions.push(tx);

                    playSound('beep');

                    MyWallet.sendEvent('on_tx');

                }  else if (obj.op == 'block') {
                    //Check any transactions included in this block, if the match one our ours then set the block index
                    for (var i = 0; i < obj.x.txIndexes.length; ++i) {
                        for (var ii = 0; ii < transactions.length; ++ii) {
                            if (transactions[ii].txIndex == obj.x.txIndexes[i]) {
                                if (transactions[ii].blockHeight == null || transactions[ii].blockHeight == 0) {
                                    transactions[ii].blockHeight = obj.x.height;
                                    break;
                                }
                            }
                        }
                    }

                    setLatestBlock(BlockFromJSON(obj.x));

                    MyWallet.sendEvent('on_block');
                }

            } catch(e) {
                console.log(e);

                console.log(e.data);
            }
        };

        ws.onopen = function() {
            MyWallet.sendEvent('ws_on_open');

            var msg = '{"op":"blocks_sub"}';

            if (guid != null)
                msg += '{"op":"wallet_sub","guid":"'+guid+'"}';

            try {
                var addrs = MyWallet.getLegacyActiveAddresses();
                for (var key in addrs) {
                    msg += '{"op":"addr_sub", "addr":"'+ addrs[key] +'"}'; //Subscribe to transactions updates through websockets
                }
                MyWallet.listenToHDWalletAccounts();
                var paidTo = MyWallet.getPaidToDictionary();
                for (var tx_hash in paidTo) {
                    if (paidTo[tx_hash].redeemedAt == null) {
                        msg += '{"op":"addr_sub", "addr":"'+ paidTo[tx_hash].address +'"}';
                    }
                }

            } catch (e) {
                alert(e);
            }

            ws.send(msg);
        };

        ws.onclose = function() {
            MyWallet.sendEvent('ws_on_close');

        };
    }

    var logout_status = 'ok';

    this.pkBytesToSipa = function(bytes, addr) {
        var bytesBigInt = new BigInteger.fromBuffer(bytes);
        var eckey = new ECKey(bytesBigInt, false);

        bytes = bytesBigInt.toByteArray();

        while (bytes.length < 32) bytes.unshift(0);

        bytes.unshift(0x80); // prepend 0x80 byte

        if (MyWallet.getUnCompressedAddressString(eckey) == addr) {
        } else if (MyWallet.getCompressedAddressString(eckey) == addr) {
            bytes.push(0x01);    // append 0x01 byte for compressed format
        } else {
            throw 'Private Key does not match bitcoin address' + addr;
        }

        var checksum = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });

        bytes = bytes.concat(checksum.slice(0, 4));

        var privWif = Bitcoin.base58.encode(new buffer.Buffer(bytes));

        return privWif;
    }

    function noConvert(x) { return x; }
    function base58ToBase58(x) { return MyWallet.decryptPK(x); }
    function base58ToBase64(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToBase64(bytes); }
    function base58ToHex(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToHex(bytes); }
    this.base58ToSipa = function(x, addr) {
        return MyWallet.pkBytesToSipa(MyWallet.decodePK(x), addr);
    }

    this.getExtPrivKeyForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getAccountExtendedKey(true);
    }

    this.getExtPubKeyForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getAccountExtendedKey(false);
    }

    this.getLabelForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getLabel();
    }

    this.setLabelForAccount = function(accountIdx, label) {
        myHDWallet.getAccount(accountIdx).setLabel(label);
        MyWallet.backupWalletDelayed();
    }

    this.isArchivedForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).isArchived();
    }

    this.setIsArchivedForAccount = function(accountIdx, isArchived) {
        myHDWallet.getAccount(accountIdx).setIsArchived(isArchived);
        MyWallet.backupWalletDelayed('update', function() {
            MyWallet.get_history();
        });
    }

    this.getAddressesForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getAddresses();
    }

    this.getChangeAddressesForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getChangeAddresses();
    }

    this.getBalanceForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getBalance();
    }

    this.getPaymentRequestsForAccount = function(accountIdx) {
        return myHDWallet.getAccount(accountIdx).getPaymentRequests();
    }

    this.generateOrReuseEmptyPaymentRequestForAccount = function(accountIdx) {
        var account = myHDWallet.getAccount(accountIdx);
        
        var requests = account.getPaymentRequests();
        
        var i, len;
        for (i = 0,  len = requests.length; i<len; i++) {
          var request = requests[i]
          if(request.label === "" && (request.amount == 0)) {
            return request;
          }
        }

        var paymentRequest = account.generatePaymentRequest(0, "");
        MyWallet.backupWalletDelayed();
        try {
            ws.send('{"op":"addr_sub", "addr":"'+account.getAddressForPaymentRequest(paymentRequest)+'"}');
        } catch (e) { }
        return paymentRequest
    }

    this.updatePaymentRequestForAccount = function(accountIdx, address, amount, label) {
        var account = myHDWallet.getAccount(accountIdx);
        var success = account.updatePaymentRequest(address, amount, label);
      
        if (success) {
            MyWallet.backupWalletDelayed();
        }
        return success;
    }

    this.acceptPaymentRequestForAccount = function(accountIdx, address) {
        var success = myHDWallet.getAccount(accountIdx).acceptPaymentRequest(address);
        if (success) {
            MyWallet.backupWalletDelayed();
        }
        return success;
    }

    this.checkToAddTxToPaymentRequestForAccount = function(account, address, txHash, amount, checkCompleted) {
        var haveAddedTxToPaymentRequest = account.checkToAddTxToPaymentRequest( address, txHash, amount, checkCompleted);
        if (haveAddedTxToPaymentRequest) {
            MyWallet.backupWalletDelayed();
        }
    }

    this.cancelPaymentRequestForAccount = function(accountIdx, address) {
        var success = myHDWallet.getAccount(accountIdx).cancelPaymentRequest(address);
        if (success) {
            MyWallet.backupWalletDelayed();
        }
        return success;
    }

    this.getAllTransactions = function() {
        var filteredTransactions = [];

        var rawTxs = transactions;

        for (var i in rawTxs) {
            var tx = rawTxs[i]; 

            var transaction = {from: {account: null, legacyAddresses: null, externalAddresses: null},
                                               to: {account: null, legacyAddresses: null, externalAddresses: null},
                                              fee: 0};
            var isOrigin = false;
            transaction.intraWallet = true;
            for (var i = 0; i < tx.inputs.length; ++i) {
                var output = tx.inputs[i].prev_out;
                if (!output || !output.addr)
                    continue;

                if (MyWallet.isActiveLegacyAddress(output.addr)) {
                    isOrigin = true;
                    if (transaction.from.legacyAddresses == null)
                        transaction.from.legacyAddresses = [];
                    transaction.from.legacyAddresses.push({address: output.addr, amount: output.value});
                    transaction.fee += output.value;
                } else {
                    for (var j in myHDWallet.getAccounts()) {
                        var account = myHDWallet.getAccount(j);
                        if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                            if (! isOrigin) {
                                isOrigin = true;
                                transaction.from.account = {index: parseInt(j), amount: output.value};
                                transaction.fee += output.value;
                            } else {
                                if (transaction.from.externalAddresses == null ||
                                    output.value > transaction.from.externalAddresses.amount) {
                                    transaction.from.externalAddresses = {addressWithLargestOutput: output.addr, amount: output.value};
                                   }
                                transaction.fee += output.value;
                            }
                            break;
                        }
                    }

                    if (! isOrigin) {
                        if (transaction.from.externalAddresses == null ||
                            output.value > transaction.from.externalAddresses.amount) {
                            transaction.from.externalAddresses = {addressWithLargestOutput: output.addr, amount: output.value};
                        }
                        transaction.fee += output.value;
                        transaction.intraWallet = false;
                    }
                }
            }

            for (var i = 0; i < tx.out.length; ++i) {
                var output = tx.out[i];
                if (!output || !output.addr)
                    continue;

                if (MyWallet.isActiveLegacyAddress(output.addr)) {
                    if (transaction.to.legacyAddresses == null)
                        transaction.to.legacyAddresses = [];
                    transaction.to.legacyAddresses.push({address: output.addr, amount: output.value});
                    transaction.fee -= output.value;
                } else {
                    var toAccountSet = false;
                    for (var j in myHDWallet.getAccounts()) {
                        var account = myHDWallet.getAccount(j);
                        if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                            if (! toAccountSet) {
                                if (transaction.from.account != null && transaction.from.account.index == parseInt(j)) {
                                    transaction.from.account.amount -= output.value;
                                } else {
                                    transaction.to.account = {index: parseInt(j), amount: output.value};                                    
                                }
                                toAccountSet = true;
                                transaction.fee -= output.value;
                            } else {
                                if (transaction.from.account != null && transaction.from.account.index == parseInt(j)) {
                                    transaction.from.account.amount -= output.value;
                                } else if (transaction.to.externalAddresses == null ||
                                    output.value > transaction.to.externalAddresses.amount) {
                                    transaction.to.externalAddresses = {addressWithLargestOutput: output.addr, amount: output.value};
                                }
                                transaction.fee -= output.value;
                            }
                            break;
                        }
                    }

                    if (! toAccountSet) {
                        if (transaction.to.externalAddresses == null ||
                            output.value > transaction.to.externalAddresses.amount) {
                            transaction.to.externalAddresses = {addressWithLargestOutput: output.addr, amount: output.value};
                        }
                        transaction.fee -= output.value;
                        transaction.intraWallet = false;
                    }                    
                }
            }

            transaction.hash = tx.hash;
            transaction.confirmations = MyWallet.getConfirmationsForTx(MyWallet.getLatestBlock(), tx);
            transaction.txTime = tx.time;
            transaction.note = tx_notes[tx.hash] ? tx_notes[tx.hash] : null;
            transaction.tags = MyWallet.getTags(tx.hash);
            transaction.size = tx.size;
            transaction.tx_index = tx.txIndex;
            transaction.block_height = tx.blockHeight;
            transaction.result = tx.result;

            filteredTransactions.push(transaction);
        }


        return filteredTransactions;
    }

    this.getLegacyTransactions = function() {
        var filteredTransactions = [];

        var rawTxs = transactions;

        for (var i in rawTxs) {
            var tx = rawTxs[i];
            var transaction = {};

            // Default values:
            transaction.to_account= null;
            transaction.from_account = null;
            transaction.from_addresses = [];
            transaction.to_addresses = [];
            transaction.amount = 0;

            var isOrigin = false;
            var isLegacyAddressTx = false;
            for (var i = 0; i < tx.inputs.length; ++i) {
                var output = tx.inputs[i].prev_out;
                if (!output || !output.addr)
                    continue;

                if (MyWallet.isActiveLegacyAddress(output.addr)) {
                    isLegacyAddressTx = true;
                    isOrigin = true;
                    transaction.amount -= output.value;
                    transaction.from_addresses.push(output.addr);
                } else {
                    transaction.from_addresses.push(output.addr);
                    for (var j in myHDWallet.getAccounts()) {
                        var account = myHDWallet.getAccount(j);
                        if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                            transaction.from_account = parseInt(j);
                            break;
                        }
                    }                    
                }
            }

            transaction.intraWallet = false;
            for (var i = 0; i < tx.out.length; ++i) {
                var output = tx.out[i];
                if (!output || !output.addr)
                    continue;

                if (MyWallet.isActiveLegacyAddress(output.addr)) {
                    isLegacyAddressTx = true;
                    transaction.amount += output.value;
                    transaction.to_addresses.push(output.addr);
                    if (isOrigin)
                        transaction.intraWallet = true;
                } else {
                    transaction.to_addresses.push(output.addr);
                    for (var j in myHDWallet.getAccounts()) {
                        var account = myHDWallet.getAccount(j);
                        if (output.xpub != null && account.getAccountExtendedKey(false) == output.xpub.m) {
                            transaction.to_account = parseInt(j);
                            if (isOrigin)
                                transaction.intraWallet = true;
                            break;
                        }
                    }
                }
            }

            if (! isLegacyAddressTx)
                continue;

            transaction.hash = tx.hash;
            transaction.confirmations = MyWallet.getConfirmationsForTx(MyWallet.getLatestBlock(), tx);

            // transaction.note = tx.note ? tx.note : tx_notes[tx.hash];

            if (tx.time > 0) {
                transaction.txTime = new Date(tx.time * 1000);
            }

            filteredTransactions.push(transaction);
        }

        return filteredTransactions;
    }

    this.getTransactionsForAccount = function(accountIdx) {
        return myHDWallet.filterTransactionsForAccount(accountIdx, MyWallet.getTransactions(), paidTo, tx_notes);
    }

    this.refreshAllPaymentRequestsAndChangeAddresses = function(successCallback, errorCallback) {
        transactions = [];
        var allAddresses = [];
        for (var i in myHDWallet.getAccounts()) {
            var account = myHDWallet.getAccount(i);
            if (! account.isArchived()) {
                allAddresses = allAddresses.concat(account.getAddresses());
                allAddresses = allAddresses.concat(account.getChangeAddresses());
            }
        }

        MyWallet.get_history_with_addresses(allAddresses, function(data) {
            parseMultiAddressJSON(data, false, true);
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
                errorCallback(e);
        });
    }

    this.asyncGetAndSetUnspentOutputsForAccount = function(accountIdx, successCallback, errorCallback) {
        var account = myHDWallet.getAccount(accountIdx);
        var addresses = account.getAddresses();
        addresses = addresses.concat(account.getChangeAddresses());

        //BlockchainAPI.get_unspent(addresses, function (obj) {
        BlockchainAPI.get_unspent([account.extendedPublicKey], function (obj) {

            obj.unspent_outputs.forEach(function(utxo) {
                var txBuffer = new Bitcoin.Buffer.Buffer(utxo.tx_hash, "hex");
                Array.prototype.reverse.call(txBuffer)
                utxo.hash = txBuffer.toString("hex");
                utxo.index = utxo.tx_output_n;
                var script = Bitcoin.Script.fromHex(utxo.script);
                utxo.address = Bitcoin.Address.fromOutputScript(script).toString();
            });

            account.setUnspentOutputs(obj.unspent_outputs);

            MyWallet.sendEvent('hw_wallet_balance_updated');
            if (successCallback) {
                successCallback(obj.unspent_outputs);
            }
        }, function(e) {
            if (errorCallback) {
                errorCallback(e);
            }
            //TODO: not clean
            MyWallet.sendEvent("msg", {type: "error", message: e.responseText ? e.responseText : e.message, platform: ""});
        }, 0, true);
    }

    this.recommendedTransactionFeeForAccount = function(accountIdx, amount) {
        if (! isAccountRecommendedFeesValid) {
            amountToRecommendedFee = {};
            isAccountRecommendedFeesValid = true;
        }

        if (amountToRecommendedFee[amount] != null) {
            return amountToRecommendedFee[amount];
        } else {
            var recommendedFee = myHDWallet.getAccount(accountIdx).recommendedTransactionFee(amount);
            
            amountToRecommendedFee[amount] = recommendedFee;

            return recommendedFee;
        }
    }

    this.getPaidToDictionary = function()  {
        return paidTo;
    }

    this.recommendedTransactionFeeForAddress = function(address, balance) {
      // TODO: calculate the correct fee:
      var obj = initNewTx();
      return obj.base_fee.toInt();
    }

    this.getBalanceForRedeemCode = function(privatekey, successCallback, errorCallback)  {
        try {
            var format = MyWallet.detectPrivateKeyFormat(privatekey);
            var privateKeyToSweep = MyWallet.privateKeyStringToKey(privatekey, format);
            var from_address = MyWallet.getUnCompressedAddressString(privateKeyToSweep);

            BlockchainAPI.get_balance([from_address], function(value) {
                if (successCallback)
                    successCallback(value);
            }, function() {
                MyWallet.sendEvent("msg", {type: "error", message: 'Error Getting Address Balance', platform: ""});
                if (errorCallback)
                    errorCallback();
            });
        } catch (e) {
            MyWallet.sendEvent("msg", {type: "error", message: 'Error Decoding Private Key. Could not claim coins.', platform: ""});
            if (errorCallback)
                errorCallback();
        } 
    }

    this.redeemFromEmailOrMobile = function(accountIdx, privatekey, successCallback, errorCallback)  {
        try {
            var format = MyWallet.detectPrivateKeyFormat(privatekey);
            var privateKeyToSweep = MyWallet.privateKeyStringToKey(privatekey, format);
            var from_address = MyWallet.getUnCompressedAddressString(privateKeyToSweep);

            BlockchainAPI.get_balance([from_address], function(value) {

                var obj = initNewTx();
                obj.fee = obj.base_fee; //Always include a fee
                var amount = Bitcoin.BigInteger.valueOf(value).subtract(obj.fee);
                var paymentRequest = MyWallet.generateOrReuseEmptyPaymentRequestForAccount(accountIdx);
                var to_address = account.getAddressForPaymentRequest(paymentRequest);
                MyWallet.updatePaymentRequestForAccount(accountIdx, to_address, parseInt(amount.toString()));
 
                obj.to_addresses.push({address: Bitcoin.Address.fromBase58Check(to_address), value : amount});
                obj.from_addresses = [from_address];
                obj.extra_private_keys[from_address] = Bitcoin.base58.encode(privateKeyToSweep.d.toBuffer(32));
                obj.ready_to_send_header = 'Bitcoins Ready to Claim.';

                obj.addListener({
                    on_success : function(e) {
                        if (successCallback)
                            successCallback();
                    },
                    on_start : function(e) {
                    },
                    on_error : function(e) {
                        if (errorCallback)
                            errorCallback(e);
                    }
                });
        
                obj.start();
            }, function() {
                MyWallet.sendEvent("msg", {type: "error", message: 'Error Getting Address Balance', platform: ""});
            });
        } catch (e) {
            console.log(e);
            MyWallet.sendEvent("msg", {type: "error", message: 'Error Decoding Private Key. Could not claim coins.', platform: ""});
        }        
    }

    this.sendToEmail = function(accountIdx, value, fixedFee, email, successCallback, errorCallback, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        sendToEmail(accountIdx, value, fixedFee, email, successCallback, errorCallback);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                sendToEmail(accountIdx, value, fixedFee, email, successCallback, errorCallback);                    
            }
        } else {
            sendToEmail(accountIdx, value, fixedFee, email, successCallback, errorCallback);                    
        }
    }

    function sendToEmail(accountIdx, value, fixedFee, email, successCallback, errorCallback)  {
        var account = myHDWallet.getAccount(accountIdx);
        var key = MyWallet.generateNewKey();
        var address = key.pub.getAddress().toString();
        var privateKey = key.toWIF();
        MyWallet.setLegacyAddressTag(address, 2);
        MyWallet.setLegacyAddressLabel(address, email + ' Sent Via Email');

        MyWallet.backupWallet('update', function(unspent_outputs) {
            MyWallet.sendEvent("msg", {type: "info", message: 'Generated new Bitcoin Address ' + address, platform: ""});

            MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function () {
                var account = myHDWallet.getAccount(accountIdx);
                var extendedPrivateKey = MyWallet.decryptPK(account.extendedPrivateKey);
                var tx = myHDWallet.getAccount(accountIdx).createTx(address, value, fixedFee, unspent_outputs, extendedPrivateKey);

                BlockchainAPI.sendViaEmail(email, tx, privateKey, function (data) {
                    BlockchainAPI.push_tx(tx, null, function(response) {
        
                        var paidToSingle = {email:email, mobile: null, redeemedAt: null, address: address};
                        paidTo[tx.getId()] = paidToSingle;

                        MyWallet.backupWallet('update', function() {

                            MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function () {
                                if (successCallback)
                                    successCallback(response);
                            }, function(e) {
                                if (errorCallback)
                                    errorCallback(e);
                            });
                        }, function() {
                            if (errorCallback)
                                errorCallback();
                        });
                    }, function(response) {
                        if (errorCallback)
                            errorCallback(response);
                    });
                }, function(data) {
                    if (errorCallback)
                        errorCallback(e);
                });
            }, function(e) {
                if (errorCallback)
                    errorCallback(e);
            });
        });
    }

    this.sendFromLegacyAddressToAddress = function(fromAddress, toAddress, amount, feeAmount, note, successCallback, errorCallback, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        sendFromLegacyAddressToAddress(fromAddress, toAddress, amount, feeAmount, note, successCallback, errorCallback);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                sendFromLegacyAddressToAddress(fromAddress, toAddress, amount, feeAmount, note, successCallback, errorCallback);                    
            }
        } else {
                sendFromLegacyAddressToAccount(fromAddress, toAddress, amount, feeAmount, note, successCallback, errorCallback);                    
        }
    }

    function sendFromLegacyAddressToAddress(fromAddress, toAddress, amount, feeAmount, note, successCallback, errorCallback)  {
        var obj = initNewTx();

        if (feeAmount != null)
            obj.fee = Bitcoin.BigInteger.valueOf(feeAmount);
        else
            obj.fee = obj.base_fee;

        obj.to_addresses.push({address: Bitcoin.Address.fromBase58Check(toAddress), value : Bitcoin.BigInteger.valueOf(amount)});
        obj.from_addresses = [fromAddress];
        obj.ready_to_send_header = 'Bitcoins Ready to Send.';

        obj.addListener({
            on_success : function(e) {
                if (successCallback)
                    successCallback();
            },
            on_start : function(e) {
            },
            on_error : function(e) {
                if (errorCallback)
                    errorCallback(e);
            }
        });

        obj.note = note;

        obj.start();
    }

    this.sendFromLegacyAddressToAccount = function(fromAddress, toIdx, amount, feeAmount, note, successCallback, errorCallback, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        sendFromLegacyAddressToAccount(fromAddress, toIdx, amount, feeAmount, note, successCallback, errorCallback);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                sendFromLegacyAddressToAccount(fromAddress, toIdx, amount, feeAmount, note, successCallback, errorCallback);                    
            }
        } else {
                sendFromLegacyAddressToAccount(fromAddress, toIdx, amount, feeAmount, note, successCallback, errorCallback);                    
        }
    }

    function sendFromLegacyAddressToAccount(fromAddress, toIdx, amount, feeAmount, note, successCallback, errorCallback)  {
        var account = myHDWallet.getAccount(toIdx);
        var obj = initNewTx();

        if (feeAmount != null)
            obj.fee = Bitcoin.BigInteger.valueOf(feeAmount);
        else
            obj.fee = obj.base_fee;

        var paymentRequest = MyWallet.generateOrReuseEmptyPaymentRequestForAccount(toIdx, amount);
        var to_address = account.getAddressForPaymentRequest(paymentRequest);
        MyWallet.updatePaymentRequestForAccount(toIdx, to_address, amount);
        obj.to_addresses.push({address: Bitcoin.Address.fromBase58Check(to_address), value : Bitcoin.BigInteger.valueOf(amount)});
        obj.from_addresses = [fromAddress];
        obj.ready_to_send_header = 'Bitcoins Ready to Send.';

        obj.addListener({
            on_success : function(e) {
                if (successCallback)
                    successCallback();
            },
            on_start : function(e) {
            },
            on_error : function(e) {
                if (errorCallback)
                    errorCallback(e);
            }
        });

        obj.note = note;

        obj.start();
    }


    this.sweepLegacyAddressToAccount = function(fromAddress, toIdx, successCallback, errorCallback, getPassword)  {
        var obj = initNewTx();
        var feeAmount = parseInt(obj.base_fee.toString());
        var amount = MyWallet.getLegacyAddressBalance(fromAddress) - feeAmount;
        MyWallet.sendFromLegacyAddressToAccount(fromAddress, toIdx, amount, feeAmount, null, successCallback, errorCallback, getPassword);
    }

    this.sendToAccount = function(fromIdx, toIdx, amount, feeAmount, note, successCallback, errorCallback, getPassword)  {
        var account = myHDWallet.getAccount(toIdx);
        var paymentRequest = MyWallet.generateOrReuseEmptyPaymentRequestForAccount(toIdx);
        var address = account.getAddressForPaymentRequest(paymentRequest);
        MyWallet.updatePaymentRequestForAccount(toIdx, address, amount);
        MyWallet.sendBitcoinsForAccount(fromIdx, address, amount, feeAmount, note, successCallback, errorCallback, getPassword);
    }

    this.sendToMobile = function(accountIdx, value, fixedFee, mobile, successCallback, errorCallback, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        sendToMobile(accountIdx, value, fixedFee, mobile, successCallback, errorCallback);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                sendToMobile(accountIdx, value, fixedFee, mobile, successCallback, errorCallback, getPassword);                    
            }
        } else {
                sendToMobile(accountIdx, value, fixedFee, mobile, successCallback, errorCallback);                    
        }
    }

    function sendToMobile(accountIdx, value, fixedFee, mobile, successCallback, errorCallback)  {
        if (mobile.charAt(0) == '0')
            mobile = mobile.substring(1);

        if (mobile.charAt(0) != '+')
            mobile = '+' + mobile;
            //mobile = '+' + child.find('select[name="sms-country-code"]').val() + mobile;


        var miniKeyAddrobj = generateNewMiniPrivateKey();
        var address = miniKeyAddrobj.key.pub.getAddress().toString();
        var privateKey = miniKeyAddrobj.key.toWIF();

        MyWallet.setLegacyAddressTag(address, 2);
        MyWallet.setLegacyAddressLabel(address, mobile + ' Sent Via SMS');

        MyWallet.backupWallet('update', function() {
            MyWallet.sendEvent("msg", {type: "info", message: 'Generated new Bitcoin Address ' + address + address, platform: ""});

            MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function (unspent_outputs) {
                var account = myHDWallet.getAccount(accountIdx);
                var extendedPrivateKey = MyWallet.decryptPK(account.extendedPrivateKey);
                var tx = myHDWallet.getAccount(accountIdx).createTx(address, value, fixedFee, unspent_outputs, extendedPrivateKey);

                BlockchainAPI.sendViaSMS(mobile, tx, privateKey, function (data) {

                    BlockchainAPI.push_tx(tx, null, function(response) {
        
                        var paidToSingle = {email: null, mobile: mobile, redeemedAt: null, address: address};
                        paidTo[tx.getId()] = paidToSingle;

                        MyWallet.backupWallet('update', function() {

                            MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function () {
                                if (successCallback)
                                    successCallback(response);
                            }, function(e) {
                                if (errorCallback)
                                    errorCallback(e);
                            });
                        }, function() {
                            if (errorCallback)
                                errorCallback();
                        });

                    }, function(response) {
                        if (errorCallback)
                            errorCallback(response);
                    });
                }, function(data) {
                    if (errorCallback)
                        errorCallback(e);   
                });
            }, function(e) {
                if (errorCallback)
                    errorCallback(e);
            });
        });
    }

    this.sendBitcoinsForAccount = function(accountIdx, to, value, fixedFee, note, successCallback, errorCallback, getPassword) {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                         sendBitcoinsForAccount(accountIdx, to, value, fixedFee, note, successCallback, errorCallback);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                sendBitcoinsForAccount(accountIdx, to, value, fixedFee, note, successCallback, errorCallback);                    
            }
        } else {
             sendBitcoinsForAccount(accountIdx, to, value, fixedFee, note, successCallback, errorCallback);            
        }
    }

    function sendBitcoinsForAccount(accountIdx, to, value, fixedFee, note, successCallback, errorCallback) {
        MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function (unspent_outputs) {
            var account = myHDWallet.getAccount(accountIdx);
            var extendedPrivateKey = MyWallet.decryptPK(account.extendedPrivateKey);
            var tx = account.createTx(to, value, fixedFee, unspent_outputs, extendedPrivateKey);
            BlockchainAPI.push_tx(tx, note, function(response) {
               MyWallet.asyncGetAndSetUnspentOutputsForAccount(accountIdx, function () {
                    if (successCallback)
                        successCallback(response);
                }, function(e) {
                    if (errorCallback)
                        errorCallback(e);
                });
            }, function(response) {
                if (errorCallback)
                    errorCallback(response);
            });

        }, function(e) {
            if (errorCallback)
                errorCallback(e);
        });
    }

    this.getAccounts = function() {
        return myHDWallet.getAccounts();
    }

    this.getAccount = function(idx) {
        return myHDWallet.getAccount(idx)
    }

    this.getAccountsCount = function() {
        return myHDWallet.getAccountsCount();
    }

    this.createAccount = function(label, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        createAccount(label);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                createAccount(label);                    
            }
        } else {
            createAccount(label);                    
        }
    }

    function createAccount(label) {
        var seedHex = MyWallet.decryptPK(myHDWallet.getSeedHexString());
        myHDWallet.createAccount(label, seedHex);
        MyWallet.backupWalletDelayed();
    }

    this.getHDWallet = function() {
        return myHDWallet;
    }

    this.isValidateBIP39Mnemonic = function(mnemonic) {
        return isValidateMnemonic(mnemonic);
    }

    this.recoverMyWalletHDWalletFromSeedHex = function(seedHex, bip39Password, successCallback, errorCallback) {
        recoverHDWalletFromSeedHex(seedHex, bip39Password, function(hdWallet) {
            myHDWallet = hdWallet;

            if (successCallback)
                successCallback();

            MyWallet.backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });
        }, function() {
            if (errorCallback)
                errorCallback();
        });
    }

    this.recoverMyWalletHDWalletFromMnemonic = function(passphrase, bip39Password, successCallback, errorCallback) {
        recoverHDWalletFromMnemonic(passphrase, bip39Password, function(hdWallet) {
            myHDWallet = hdWallet;

            if (successCallback)
                successCallback();

            MyWallet.backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });
        }, function() {
            if (errorCallback)
                errorCallback();
        });
    }

    this.listenToHDWalletAccountAddresses = function(accountIdx) {
        var account = myHDWallet.getAccount(accountIdx);
        var msg = "";

        var paymentRequests = account.getPaymentRequests();
        var addresses = account.getChangeAddresses();
        for (var i in paymentRequests) {
            var paymentRequest = paymentRequests[i];
            if (paymentRequest.complete == true)
                continue;

            try {
                msg += '{"op":"addr_sub", "addr":"'+ account.getAddressForPaymentRequest(paymentRequest) +'"}';
            } catch (e) { }
        }

        var changeAdresses = account.getChangeAddresses();
        for (var i in changeAdresses) {
            var address = changeAdresses[i];
            try {
                msg += '{"op":"addr_sub", "addr":"'+ address +'"}';
            } catch (e) { }
        }

        ws.send(msg);
    }

    this.listenToHDWalletAccounts = function() {
        if (myHDWallet) {
            for (var i in myHDWallet.getAccounts()) {
                MyWallet.listenToHDWalletAccountAddresses(i);
            }
        }
    }

    this.buildHDWallet = function(seedHexString, accountsArrayPayload) {
        myHDWallet = buildHDWallet(seedHexString, accountsArrayPayload);
    }

    this.generateHDWalletPassphrase = function() {
        return BIP39.generateMnemonic();
    }

    this.generateHDWalletSeedHex = function() {
        var passPhrase = MyWallet.generateHDWalletPassphrase();
        return passphraseToPassphraseHexString(passPhrase);
    }

    this.deleteHDWallet = function(successCallback, errorCallback) {
        myHDWallet = null;
        MyWallet.backupWallet('update', function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
                errorCallback();
        });
    }

    this.initializeHDWallet = function(passphrase, bip39Password, getPassword)  {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        initializeHDWallet(passphrase, bip39Password);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                    }
                });            
            } else {
                initializeHDWallet(passphrase, bip39Password);                    
            }
        } else {
            initializeHDWallet(passphrase, bip39Password);                    
        }
    }

    function initializeHDWallet(passphrase, bip39Password) {
        var seedHexString = null;
        if (passphrase == null)
            seedHexString = MyWallet.generateHDWalletSeedHex();
        else
            seedHexString = passphraseToPassphraseHexString(passphrase);

        MyWallet.buildHDWallet(seedHexString, [], bip39Password);
        MyWallet.createAccount("Spending", seedHexString);
    }

    this.getHDWalletPassphraseString = function(getPassword) {
        if (double_encryption) {
            if (dpassword == null) {
                getPassword(function(pw) {
                    if (MyWallet.validateSecondPassword(pw)) {
                        var seed = MyWallet.decryptPK(myHDWallet.getSeedHexString());
                        return myHDWallet.getPassphraseString(seed);                    
                    } else {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});
                        return null;
                    }
                });            
            } else {
                var seed = myHDWallet.getSeedHexString();
                return myHDWallet.getPassphraseString(seed);                    
            }
        } else {
            var seed = myHDWallet.getSeedHexString();
            return myHDWallet.getPassphraseString(seed);                    
        }  
    }

    this.isValidAddress = function(candidate) {
        try {
            Bitcoin.Address.fromBase58Check(candidate);
            return true;
        } catch (e) {
            return false;
        }
    }

    this.isValidPrivateKey = function(candidate) {
        try {
            var format = MyWallet.detectPrivateKeyFormat(candidate);
            var key = MyWallet.privateKeyStringToKey(candidate, format);
            return key.pub.getAddress().toString();
        } catch (e) {
            return false;
        }
    }


    this.makeWalletJSON = function(format) {
        return MyWallet.makeCustomWalletJSON(format, guid, sharedKey);
    }

    this.makeCustomWalletJSON = function(format, guid, sharedKey) {

        var encode_func = noConvert;

        if (format == 'base64')
            encode_func = base58ToBase64;
        else if (format == 'hex')
            encode_func = base58ToHex;
        else if (format == 'sipa')
            encode_func = MyWallet.base58ToSipa;
        else if (format == 'base58')
            encode_func = base58ToBase58;

        var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';

        if (double_encryption && dpasswordhash != null && encode_func == noConvert) {
            out += '	"double_encryption" : '+double_encryption+',\n	"dpasswordhash" : "'+dpasswordhash+'",\n';
        }

        if (wallet_options) {
            out += '	"options" : ' + JSON.stringify(wallet_options)+',\n';
        }

        out += '	"keys" : [\n';

        var atLeastOne = false;

        for (var key in addresses) {
            var addr = $.extend({}, addresses[key]);

            if (addr.tag == 1) {
                delete addr.tag;
            }

            if (addr.priv != null) {
                addr.priv = encode_func(addr.priv, addr.addr);
            }

            //Delete null values
            for (var i in addr) {
                if (addr[i] === null || addr[i] === undefined) {
                    delete addr[i];
                }
            }

            //balance property should not be saved
            delete addr.balance;

            out += JSON.stringify(addr) + ',\n';

            atLeastOne = true;
        }

        if (atLeastOne) {
            out = out.substring(0, out.length-2);
        }

        out += "\n	]";

        if (nKeys(address_book) > 0) {
            out += ',\n	"address_book" : [\n';

            for (var key in address_book) {
                out += '	{"addr" : "'+ key +'",\n';
                out += '	 "label" : "'+ address_book[key] + '"},\n';
            }

            //Remove the extra comma
            out = out.substring(0, out.length-2);

            out += "\n	]";
        }

        if (nKeys(tx_notes) > 0) {
            out += ',\n	"tx_notes" : ' + JSON.stringify(tx_notes)
        }

        if (nKeys(tx_tags) > 0) {
            out += ',\n	"tx_tags" : ' + JSON.stringify(tx_tags)
        }

        if (tag_names != null) {
            out += ',\n	"tag_names" : ' + JSON.stringify(tag_names)
        }

        out += ',\n	"hd_wallets" : [\n';

        if (myHDWallet != null) {
            out += '	{"seed_hex" : "'+ myHDWallet.getSeedHexString() +'",\n';
            out += '    "mnemonic_verified" : "'+ mnemonicVerified +'",\n';
            out += '    "default_account_idx" : "'+ defaultAccountIdx +'",\n';
            if (paidTo != null) {
                out += '"paidTo" : ' + JSON.stringify(paidTo) +',\n';
            }

            out += '	"accounts" : [\n';

            for (var i in myHDWallet.getAccounts()) {
                var account = myHDWallet.getAccount(i);

                var accountJsonData = account.getAccountJsonData();
                out += JSON.stringify(accountJsonData);
                if (i < myHDWallet.getAccountsCount() - 1) {
                    out += ",\n";
                }
            }
            out += "\n	]";
            out += '\n	}';
        }

        out += "\n	]";

        out += '\n}';

        //Write the address book
        return out;
    }

    this.get_ticker = function(successCallback, errorCallback) {
        BlockchainAPI.get_ticker(successCallback, errorCallback);
    }

    this.getFiatAtTime = function(time, value, currencyCode, successCallback, errorCallback) {
        BlockchainAPI.getFiatAtTime(time, value, currencyCode, successCallback, errorCallback);
    }

    this.get_account_info = function(successCallback, errorCallback) {
        BlockchainAPI.get_account_info(successCallback, errorCallback);
    }

    this.change_language = function(language, successCallback, errorCallback) {
        BlockchainAPI.change_language(language, function() {
            MyWallet.setLanguage(language);

            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.change_local_currency = function(code, successCallback, errorCallback) {
        BlockchainAPI.change_local_currency(code, function() {
            var original_code = symbol_local.code;
            symbol_local.code = code;
            MyWallet.get_history();
            symbol_local.code = original_code;
            MyWallet.setLocalSymbolCode(code);

            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.change_btc_currency = function(code, successCallback, errorCallback) {
        BlockchainAPI.change_btc_currency(code, function() {
            var original_code = symbol_btc.code;
            symbol_btc.code = code;
            MyWallet.get_history();
            symbol_btc.code = original_code;

            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.update_tor_ip_block = function(enabled, successCallback, errorCallback) {
        BlockchainAPI.update_tor_ip_block(enabled ? 1 : 0, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.update_password_hint1 = function(value, successCallback, errorCallback) {
        BlockchainAPI.update_password_hint1(value, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.update_password_hint2 = function(value, successCallback, errorCallback) {
        BlockchainAPI.update_password_hint2(value, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.change_email = function(email, successCallback, errorCallback) {
        BlockchainAPI.change_email(email, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.changeMobileNumber = function(val, successCallback, errorCallback) {
        BlockchainAPI.changeMobileNumber(val, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.verifyMobile = function(code, successCallback, errorCallback) {
        BlockchainAPI.verifyMobile(code, function(data) {
            if (successCallback)
                successCallback(data);
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.disableSaveTwoFactor = function(successCallback, errorCallback) {
        BlockchainAPI.toggleSave2FA(true, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.enableSaveTwoFactor = function(successCallback, errorCallback) {
        BlockchainAPI.toggleSave2FA(false, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.unsetTwoFactor = function(successCallback, errorCallback) {
        BlockchainAPI.unsetTwoFactor(successCallback, errorCallback);
    }

    this.setTwoFactorSMS = function(successCallback, errorCallback) {
        BlockchainAPI.setTwoFactorSMS(successCallback, errorCallback);
    }

    this.setTwoFactorYubiKey = function(successCallback, errorCallback) {
        BlockchainAPI.setTwoFactorYubiKey(successCallback, errorCallback);
    }

    this.setTwoFactorEmail = function(successCallback, errorCallback) {
        BlockchainAPI.setTwoFactorEmail(successCallback, errorCallback);
    }

    this.setTwoFactorGoogleAuthenticator = function(successCallback, errorCallback) {
        BlockchainAPI.setTwoFactorGoogleAuthenticator(function(google_secret_url) {
            if (successCallback)
                successCallback(google_secret_url);
        }, function(e) {
            if (errorCallback)
               errorCallback(e);
        });
    }

    this.confirmTwoFactorGoogleAuthenticator = function(code, successCallback, errorCallback) {
        BlockchainAPI.confirmTwoFactorGoogleAuthenticator(code, function() {
            if (successCallback)
                successCallback();
        }, function() {
            if (errorCallback)
               errorCallback();
        });
    }

    this.get_history_with_addresses = function(addresses, success, error) {
        BlockchainAPI.get_history_with_addresses(addresses, function(data) {
            if (success) success(data);
        }, function() {
            if (error) error();

        }, tx_filter, tx_page*MyWallet.getNTransactionsPerPage(), MyWallet.getNTransactionsPerPage());
    }

    this.get_history = function(success, error) {
        BlockchainAPI.get_history(function(data) {

            parseMultiAddressJSON(data, false, false);

            if (success) success();

        }, function() {
            if (error) error();

        }, tx_filter, tx_page*MyWallet.getNTransactionsPerPage(), MyWallet.getNTransactionsPerPage());
    }

    this.deleteAddressBook = function(addr) {
        delete address_book[addr];

        MyWallet.backupWalletDelayed();
    }

    this.getAllLegacyAddresses = function() {
        var array = [];
        for (var key in addresses) {
            array.push(key);
        }
        return array;
    }

    //Find the preferred address to use for change
    //Order deposit / request coins
    this.getPreferredLegacyAddress = function() {
        var preferred = null;
        for (var key in addresses) {
            var addr = addresses[key];

            if (preferred == null)
                preferred = addr;

            if (addr.priv != null) {
                if (preferred == null)
                    preferred = addr;

                if (addr.tag == null || addr.tag == 0) {
                    preferred = addr;
                    break;
                }
            }
        }

        return preferred.addr;
    }

    this.hasLegacyAddresses = function() {
        return addresses.length != 0;
    }

    this.getLegacyActiveAddresses = function() {
        var array = [];
        for (var key in addresses) {
            var addr = addresses[key];
            //Don't include archived addresses
            if (addr.tag != 2)
                array.push(addr.addr);
        }
        return array;
    }


    this.getLegacyArchivedAddresses = function() {
        var array = [];
        for (var key in addresses) {
            var addr = addresses[key];
            //Don't include archived addresses
            if (addr.tag == 2)
                array.push(addr.addr);
        }
        return array;
    }

    this.getLatestBlock = function() {
        return latest_block;
    }

    this.getConfirmationsForTx = function(latest_block, tx) {
        if (tx.blockHeight != null && tx.blockHeight > 0) {
            return latest_block.height - tx.blockHeight + 1;
        } else {
            tx.setConfirmations(0);
            return 0;
        }
    }

    function setLatestBlock(block) {

        if (block != null) {
            latest_block = block;

            for (var key in transactions) {
                var tx = transactions[key];
                tx.setConfirmations(MyWallet.getConfirmationsForTx(latest_block, tx));
            }

            MyWallet.sendEvent('did_set_latest_block');
        }
    }
    
    this.getNote = function(tx_hash) {
        return tx_notes[tx_hash];
    }

    this.deleteNote = function(tx_hash) {
        delete tx_notes[tx_hash];


        MyWallet.backupWalletDelayed();
    }

    this.setNote = function(tx_hash, text) {
        tx_notes[tx_hash] = text;
        MyWallet.backupWalletDelayed();
    }

    this.getTags = function(tx_hash) {
        return tx_tags[tx_hash];
    }

    this.setTag = function(tx_hash, idx) {
        if (tx_tags[tx_hash] == null) {
            tx_tags[tx_hash] = [];
        }
        tx_tags[tx_hash].push(idx);
        MyWallet.backupWalletDelayed();
    }

    this.unsetTag = function(tx_hash, idx) {
        var tags = tx_tags[tx_hash];
        var index = tx_tags.indexOf(idx);
        if (index > -1) {
            tx_tags.splice(index, 1);
        }
        MyWallet.backupWalletDelayed();
    }

    this.getTagNames = function() {
        return tag_names;
    }

    this.addTag = function(name) {
        tag_names.push(name);
        MyWallet.backupWalletDelayed();
    }

    this.renameTag = function(idx, name) {
        tag_names[idx] = name;
        MyWallet.backupWalletDelayed();
    }

    this.deleteTag = function(idx) {
        tag_names.splice(idx,1);

        for (var tx_hash in tx_tags) {
            var tags = tx_tags[tx_hash];
            var index = tx_tags.indexOf(idx);
            if (index > -1) {
                tx_tags.splice(index, 1);
            }
        }
        //MyWallet.backupWalletDelayed();
    }

    function isAlphaNumericSpace(input) {
        return /^[\w\-,._  ]+$/.test(input);
    }
        
    function parseMultiAddressJSON(obj, cached, checkCompleted) {
        if (!cached) {
            if (obj.mixer_fee) {
                mixer_fee = obj.mixer_fee;
            }

            recommend_include_fee = obj.recommend_include_fee;

            if (obj.info) {
                if (obj.info.symbol_local)
                    setLocalSymbol(obj.info.symbol_local);

                if (obj.info.symbol_btc)
                    setBTCSymbol(obj.info.symbol_btc);

                if (obj.info.notice)
                    MyWallet.sendEvent("msg", {type: "error", message: obj.info.notice, platform: ""});
            }
        }

        if (obj.disable_mixer) {
            //$('#shared-addresses,#send-shared').hide();
        }

        sharedcoin_endpoint = obj.sharedcoin_endpoint;

        transactions.length = 0;

        if (obj.wallet == null) {
            total_received = 0;
            total_sent = 0;
            final_balance = 0;
            n_tx = 0;
            n_tx_filtered = 0;
            return;
        }

        total_received = obj.wallet.total_received;
        total_sent = obj.wallet.total_sent;
        final_balance = obj.wallet.final_balance;
        n_tx = obj.wallet.n_tx;
        n_tx_filtered = obj.wallet.n_tx_filtered;

        for (var i = 0; i < obj.addresses.length; ++i) {
            if (addresses[obj.addresses[i].address])
                MyWallet.setLegacyAddressBalance(obj.addresses[i].address, obj.addresses[i].final_balance)
                // addresses[obj.addresses[i].address].balance = obj.addresses[i].final_balance;

            for (var j in myHDWallet.getAccounts()) {
                var account = myHDWallet.getAccount(j);

                var extPubKey = account.getAccountExtendedKey(false);

                if (extPubKey == obj.addresses[i].address) {
                    account.setBalance(obj.addresses[i].final_balance);
                }

                if (account.isAddressPartOfInternalAccountAddress(obj.addresses[i].address)) {
                    account.setChangeAddressNTxs(obj.addresses[i].address, obj.addresses[i].n_tx);
                }
            }
        }

        isAccountRecommendedFeesValid = false;
        for (var i = 0; i < obj.txs.length; ++i) {
            var tx = TransactionFromJSON(obj.txs[i]);
            //Don't use the result given by the api because it doesn't include archived addresses
            tx.result = calcTxResult(tx, false, checkCompleted);

            transactions.push(tx);
        }

        if (!cached) {
            if (obj.info.latest_block)
                setLatestBlock(obj.info.latest_block);
        }

        MyWallet.sendEvent('did_multiaddr');
    }

    function didDecryptWallet(success) {

        //We need to check if the wallet has changed
        MyWallet.getWallet();

        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());

        success();
    }

    this.getHistoryAndParseMultiAddressJSON = function() {
        ///Get the list of transactions from the http API
        MyWallet.get_history(null, function() {
            MyStore.get('multiaddr', function(multiaddrjson) {
                if (multiaddrjson != null) {
                    parseMultiAddressJSON($.parseJSON(multiaddrjson), true, false);
                }
            });
        });
    }

    function checkWalletChecksum(payload_checksum, success, error) {
        var data = {method : 'wallet.aes.json', format : 'json', checksum : payload_checksum};

        MyWallet.securePost("wallet", data, function(obj) {
            if (!obj.payload || obj.payload == 'Not modified') {
                if (success) success();
            } else if (error) error();
        }, function(e) {
            if (error) error();
        });
    }

    //Fetch a new wallet from the server
    //success(modified true/false)
    this.getWallet = function(success, error) {
        var data = {method : 'wallet.aes.json', format : 'json'};

        if (payload_checksum && payload_checksum.length > 0)
            data.checksum = payload_checksum;

        MyWallet.sendEvent("msg", {type: "info", message: "Checking For Wallet Updates", platform: "iOS"});


        MyWallet.securePost("wallet", data, function(obj) {
            if (!obj.payload || obj.payload == 'Not modified') {
                if (success) success();
                return;
            }

            MyWallet.setEncryptedWalletData(obj.payload);

            internalRestoreWallet(function() {
                MyWallet.get_history();

                if (success) success();
            }, function() {
                if (error) error();
            });
        }, function(e) {
            if (error) error();
        });
    }

    function internalRestoreWallet(success, error) {
        if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
            error('No Wallet Data To Decrypt');
            return;
        }

        MyWallet.decryptWallet(encrypted_wallet_data, password, function(obj, rootContainer) {
            try {
                sharedKey = obj.sharedKey;

                if (!sharedKey || sharedKey.length == 0 || sharedKey.length != 36) {
                    throw 'Shared Key is invalid';
                }

                if (rootContainer) {
                    encryption_version_used = rootContainer.version;
                    main_pbkdf2_iterations = rootContainer.pbkdf2_iterations;
                }

                if (obj.double_encryption && obj.dpasswordhash) {
                    double_encryption = obj.double_encryption;
                    dpasswordhash = obj.dpasswordhash;
                }


                if (obj.options) {
                    $.extend(wallet_options, obj.options);
                }

                addresses = {};
                for (var i = 0; i < obj.keys.length; ++i) {
                    var key = obj.keys[i];
                    if (!key.addr || !isAlphaNumericSpace(key.addr)) {
                        MyWallet.sendEvent("msg", {type: "error", message: 'Your wallet contains an invalid address. This is a sign of possible corruption, please double check all your BTC is accounted for. Backup your wallet to remove this error.', platform: ""});
                            continue;
                    }

                    if (key.tag == 1 || !isAlphaNumericSpace(key.tag)) {
                        key.tag = null;
                    }

                    if (key.label && !isAlphaNumericSpace(key.label)) {
                        key.label = null;
                    }

                    addresses[key.addr] = key;
                }

                address_book = {};
                if (obj.address_book) {
                    for (var i = 0; i < obj.address_book.length; ++i) {
                        var entry = obj.address_book[i];

                        if (entry.label && isAlphaNumericSpace(entry.label) && isAlphaNumericSpace(entry.addr)) {
                            MyWallet.addAddressBookEntry(entry.addr, entry.label);
                        }
                    }
                }

                if (obj.hd_wallets && obj.hd_wallets.length > 0) {
                    var defaultHDWallet = obj.hd_wallets[0];
                    if (haveBuildHDWallet == false) {
                        MyWallet.buildHDWallet(defaultHDWallet.seed_hex, defaultHDWallet.accounts);
                        haveBuildHDWallet = true;
                    }
                    if (defaultHDWallet.mnemonic_verified) {
                        mnemonicVerified = defaultHDWallet.mnemonic_verified;
                    } else {
                        mnemonicVerified = false;
                    }
                    if (defaultHDWallet.default_account_idx) {
                        defaultAccountIdx = defaultHDWallet.default_account_idx;
                    } else {
                        defaultAccountIdx = 0;
                    }

                    if (defaultHDWallet.paidTo != null) {
                        for (var tx_hash in defaultHDWallet.paidTo) {
                            paidTo[tx_hash] = defaultHDWallet.paidTo[tx_hash];

                            if (paidTo[tx_hash].redeemedAt == null) {
                                paidToAddressesToBalance[paidTo[tx_hash].address] = 0;
                            }
                        }
                    }                

                } else {
                    MyWallet.sendEvent('hd_wallets_does_not_exist');
                }

                if (obj.tx_notes) {
                    for (var tx_hash in obj.tx_notes) {
                        var note = obj.tx_notes[tx_hash];

                        if (note && isAlphaNumericSpace(note)) {
                            tx_notes[tx_hash] = note;
                        }
                    }
                }

                if (obj.tx_tags) {
                    for (var tx_hash in obj.tx_tags) {
                        var tags = obj.tx_tags[tx_hash];

                        if (tags && isAlphaNumericSpace(tags)) {
                            tx_tags[tx_hash] = tags;
                        }
                    }
                }
                if (obj.tag_names) {
                    tag_names = obj.tag_names;
                }


                //If we don't have a checksum then the wallet is probably brand new - so we can generate our own
                if (payload_checksum == null || payload_checksum.length == 0) {
                    payload_checksum = generatePayloadChecksum();
                }

                setIsInitialized();

                success();
            } catch (e) {
                error(e);
            };
        }, error);
    }

    this.getPassword = function(modal, success, error) {

        if (!modal.is(':visible')) {
            modal.trigger('hidden');
            modal.unbind();
        }

        modal.modal({
            keyboard: false,
            backdrop: "static",
            show: true
        });

        //Center
        modal.center();

        var input = modal.find('input[name="password"]');

        //Virtual On-Screen Keyboard
        var $write = input,
            shift = false,
            capslock = false;

        modal.find('.vkeyboard li').unbind().click(function(){

            var $this = $(this),
                character = $this.html(); // If it's a lowercase letter, nothing happens to this variable

            // Shift keys
            if ($this.hasClass('left-shift') || $this.hasClass('right-shift')) {
                $('.letter').toggleClass('uppercase');
                $('.symbol span').toggle();

                shift = (shift === true) ? false : true;
                capslock = false;
                return false;
            }

            // Caps lock
            if ($this.hasClass('capslock')) {
                $('.letter').toggleClass('uppercase');
                capslock = true;
                return false;
            }

            // Delete
            if ($this.hasClass('delete')) {
                var html = $write.val();

                $write.val(html.substr(0, html.length - 1));
                return false;
            }

            // Special characters
            if ($this.hasClass('symbol')) character = $('span:visible', $this).html();
            if ($this.hasClass('space')) character = ' ';
            if ($this.hasClass('tab')) character = "\t";
            if ($this.hasClass('return')) character = "\n";

            // Uppercase letter
            if ($this.hasClass('uppercase')) character = character.toUpperCase();

            // Remove shift once a key is clicked.
            if (shift === true) {
                $('.symbol span').toggle();
                if (capslock === false) $('.letter').toggleClass('uppercase');

                shift = false;
            }

            // Add the character
            $write.val($write.val() + character);
        });

        input.keypress(function(e) {
            if(e.keyCode == 13) { //Pressed the return key
                e.preventDefault();
                modal.find('.btn.btn-primary').click();
            }
        });

        input.val('');

        var primary_button = modal.find('.btn.btn-primary');
        primary_button.click(function() {
            if (success) {
                error = null;

                var ccopy = success;
                success = null;

                setTimeout(function() {
                    modal.modal('hide');

                    ccopy(input.val());
                }, 10);
            } else {
                modal.modal('hide');
            }
        });

        var secondary_button = modal.find('.btn.btn-secondary');
        secondary_button.click(function() {
            if (error) {
                var ccopy = error;

                error = null;
                success = null;

                setTimeout(function() {
                    modal.modal('hide');

                    try { ccopy(); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                }, 10);
            } else {
                modal.modal('hide');
            }
        });

        modal.on('hidden', function () {
            input.unbind();
            secondary_button.unbind();
            primary_button.unbind();
            modal.unbind();

            if (error) {
                var ccopy = error;

                error = null;
                success = null;

                setTimeout(function() {
                    try { ccopy(); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                }, 10);
            }
        });
    }

    this.makePairingCode = function(success, error) {
        try {
            MyWallet.securePost('wallet', { method : 'pairing-encryption-password' }, function(encryption_phrase) {
                success('1|' + guid + '|' + MyWallet.encrypt(sharedKey + '|' + CryptoJS.enc.Utf8.parse(password).toString(), encryption_phrase, 10))
            }, function(e) {
                error(e);
            });
        } catch (e) {
            error(e);
        }
    }

    this.getMainPassword = function(success, error) {
        //If the user has input their password recently just call the success handler
        if (last_input_main_password > new Date().getTime() - main_password_timeout)
            return success(password);

        MyWallet.getPassword($('#main-password-modal'), function(_password) {

            if (password == _password) {
                last_input_main_password = new Date().getTime();

                if (success) {
                    try { success(password); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                }
            } else {
                MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});

                if (error) {
                    try { error(); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                }
            }
        }, error);
    }

    this.getSecondPassword = function(success, error) {
        if (!double_encryption || dpassword != null) {
            if (success) {
                try { success(dpassword); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""});  }
            }
            return;
        }

        MyWallet.getPassword($('#second-password-modal'), function(_password) {
            try {
                if (MyWallet.validateSecondPassword(_password)) {
                    if (success) {
                        try { success(_password); } catch (e) { console.log(e); MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                    }
                } else {
                    MyWallet.sendEvent("msg", {type: "error", message: 'Password incorrect.', platform: ""});

                    if (error) {
                        try { error(); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                    }
                }
            } catch (e) {
                if (error) {
                    try { error(); } catch (e) { MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""}); }
                }
            }
        }, error);
    }

    //Fetch information on a new wallet identfier
    this.fetchWalletJson = function(user_guid, shared_key, resend_code, inputedPassword, twoFACode, success,needs_two_factor_code, wrong_two_factor_code, other_error) {
//        console.log('Set GUID ' + user_guid);
 
        if (didSetGuid) {
            MyWallet.restoreWallet(inputedPassword, twoFACode, success, wrong_two_factor_code, other_error);
            return;
        }
 
        if (isInitialized) {
            other_error('Cannot Set GUID Once Initialized');
            return;
        }

        guid = user_guid;
        sharedKey = shared_key;

        MyWallet.sendEvent("msg", {type: "info", message: 'Downloading Wallet', platform: "iOS"});

        var clientTime=(new Date()).getTime();
        var data = {format : 'json', resend_code : resend_code, ct : clientTime};

        if (payload_checksum) {
            data.checksum = payload_checksum;
        }

        if (sharedKey) {
            data.sharedKey = sharedKey;
        }

        data.api_code = MyWallet.getAPICode();

        $.ajax({
            type: "GET",
            dataType: 'json',
            url: BlockchainAPI.getRootURL() + 'wallet/'+user_guid,
            data : data,
            timeout: 60000,
            success: function(obj) {
                MyWallet.handleNTPResponse(obj, clientTime);

                if (!obj.guid) {
                    MyWallet.sendEvent("msg", {type: "error", message: 'Server returned null guid.', platform: ""});
                    other_error('Server returned null guid.');
                    return;
                }

                guid = obj.guid;
                auth_type = obj.auth_type;
                real_auth_type = obj.real_auth_type;
                sync_pubkeys = obj.sync_pubkeys;

                if (obj.payload && obj.payload.length > 0 && obj.payload != 'Not modified') {
                    MyWallet.setEncryptedWalletData(obj.payload);
                } else {
                    didSetGuid = true;
                    needs_two_factor_code(MyWallet.get2FAType());
                    return;
                }

                war_checksum = obj.war_checksum;

                setLocalSymbol(obj.symbol_local);
                MyWallet.setLocalSymbolCode(obj.symbol_local.code);

                setBTCSymbol(obj.symbol_btc);

                if (obj.initial_error) {
                    MyWallet.sendEvent("msg", {type: "error", message: obj.initial_error, platform: ""});
                }

                if (obj.initial_success) {
                    MyWallet.sendEvent("msg", {type: "success", message: obj.initial_success, platform: ""});
                }

                MyStore.get('guid', function(local_guid) {
                    if (local_guid != guid) {
                        MyStore.remove('guid');
                        MyStore.remove('multiaddr');
                        MyStore.remove('payload');

                        //Demo Account Guid
                        if (guid != demo_guid) {
                            MyStore.put('guid', guid);
                        }
                    }
                });

                if (obj.language && language != obj.language) {
                    MyWallet.setLanguage(obj.language);
                }

                didSetGuid = true;
                MyWallet.restoreWallet(inputedPassword, twoFACode, success, wrong_two_factor_code, other_error);
            },
            error : function(e) {

                MyStore.get('guid', function(local_guid) {
                    MyStore.get('payload', function(local_payload) {
                        //Error downloading wallet from server
                        //But we can use the local cache

                        if (local_guid == user_guid && local_payload) {
                            MyWallet.setEncryptedWalletData(local_payload);

                            //Generate a new Checksum
                            guid = local_guid;
                            payload_checksum = generatePayloadChecksum();
                            auth_type = 0;

                            didSetGuid = true;
                            MyWallet.restoreWallet(inputedPassword, twoFACode, success, wrong_two_factor_code, other_error);
                        }  else {
                            MyWallet.sendEvent('did_fail_set_guid');

                            try {
                                var obj = $.parseJSON(e.responseText);

                                if (obj.authorization_required) {
                                    MyWallet.pollForSessionGUID(user_guid, shared_key, resend_code, inputedPassword, twoFACode, success, needs_two_factor_code, wrong_two_factor_code, other_error);
                                }

                                if (obj.initial_error) {
                                    MyWallet.sendEvent("msg", {type: "error", message: obj.initial_error, platform: ""});
                                }

                                return;
                            } catch (ex) {}

                            if (e.responseText)
                                MyWallet.sendEvent("msg", {type: "error", message: e.responseText, platform: ""});
                            else
                                MyWallet.sendEvent("msg", {type: "error", message: 'Error changing wallet identifier', platform: ""});
                        }
                    });
                });
            }
        });
    }

    this.pollForSessionGUID = function(user_guid, shared_key, resend_code, inputedPassword, twoFACode, success, needs_two_factor_code, wrong_two_factor_code, other_error) {
        if (isPolling) return;

        isPolling = true;

        $.ajax({
            dataType: 'json',
            type: "GET",
            url: BlockchainAPI.getRootURL() + 'wallet/poll-for-session-guid',
            success: function (obj) {
                var self = this;
                if (obj.guid) {

                    isPolling = false;

                    MyWallet.sendEvent("msg", {type: "success", message: 'Authorization Successful', platform: ""});

                    MyWallet.fetchWalletJson(user_guid, shared_key, resend_code, inputedPassword, twoFACode, success, needs_two_factor_code, wrong_two_factor_code, other_error);
                } else {
                    if (counter < 600) {
                        ++counter;
                        setTimeout(function() {
                            $.ajax(self);
                        }, 2000);
                    } else {
                        isPolling = false;
                    }
                }
            },
            error : function() {
                isPolling = false;
            }
        });
    }

    this.restoreWallet = function(pw, two_factor_auth_key, success, wrong_two_factor_code, other_error) {

        if (isInitialized || isRestoringWallet) {
            return;
        }

        function _error(e) {
            isRestoringWallet = false;
            MyWallet.sendEvent("msg", {type: "error", message: e, platform: ""});

            MyWallet.sendEvent('error_restoring_wallet');
            other_error(e);
        }

        try {
            isRestoringWallet = true;

            password = pw;

            //Main Password times out after 10 minutes
            last_input_main_password = new Date().getTime();

            //If we don't have any wallet data then we must have two factor authentication enabled
            if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
                MyWallet.sendEvent("msg", {type: "info", message: 'Validating Authentication key', platform: "iOS"});

                if (two_factor_auth_key == null) {
                    other_error('Two Factor Authentication code this null');
                    return;
                }

                if (two_factor_auth_key.length == 0 || two_factor_auth_key.length > 255) {
                    other_error('You must enter a Two Factor Authentication code');
                    return;
                }

                $.ajax({
                    timeout: 60000,
                    type: "POST",
                    url: BlockchainAPI.getRootURL() + "wallet",
                    data :  { guid: guid, payload: two_factor_auth_key, length : two_factor_auth_key.length,  method : 'get-wallet', format : 'plain', api_code : MyWallet.getAPICode()},
                    success: function(data) {
                        try {
                            if (data == null || data.length == 0) {
                                other_error('Server Return Empty Wallet Data');
                                return;
                            }

                            if (data != 'Not modified') {
                                MyWallet.setEncryptedWalletData(data);
                            }

                            internalRestoreWallet(function() {
                                isRestoringWallet = false;

                                didDecryptWallet(success);
                            }, _error);
                        } catch (e) {
                            _error(e);
                        }
                    },
                    error : function (response) {
                        _error(response.responseText);
                        wrong_two_factor_code();
                    }
                });
            } else {
                internalRestoreWallet(function() {
                    isRestoringWallet = false;

                    didDecryptWallet(success);
                }, _error);
            }
        } catch (e) {
            _error(e);
        }
    }

    this.getIsInitialized = function() {
        return isInitialized;
    }

    function setIsInitialized() {
        if (isInitialized) return;

        webSocketConnect(wsSuccess);

        isInitialized = true;
    }

    this.connectWebSocket = function() {
        webSocketConnect(wsSuccess);
    }
    
    function emailBackup() {
        MyWallet.sendEvent("msg", {type: "info", message: 'Sending email backup', platform: "iOS"});

        MyWallet.securePost("wallet", { method : 'email-backup' }, function(data) {
            MyWallet.sendEvent("msg", {type: "success", message: 'backup-success' + data, platform: ""});
        }, function(e) {
            MyWallet.sendEvent("msg", {type: "error", message: e.responseText, platform: ""});
        });
    }

    this.getLocalWalletJson = function() {
            var obj = null;
            try {
                var obj = $.parseJSON(localWalletJsonString);
                return obj;
            } catch (e) {
                return null;
            }
    }

    //Can call multiple times in a row and it will backup only once after a certain delay of activity
    this.backupWalletDelayed = function(method, success, error, extra) {
        if (!sharedKey || sharedKey.length == 0 || sharedKey.length != 36) {
            throw 'Cannot backup wallet now. Shared key is not set';
        }

        MyWallet.disableLogout(true);
        isSynchronizedWithServer = false;
        if (archTimer) {
            clearInterval(archTimer);
            archTimer = null;
        }

        archTimer = setTimeout(function (){
            MyWallet.backupWallet(method, success, error, extra);
        }, 3000);
    }

    //Save the javascript wallet to the remote server
    this.backupWallet = function(method, successcallback, errorcallback) {
        if (!sharedKey || sharedKey.length == 0 || sharedKey.length != 36) {
            throw 'Cannot backup wallet now. Shared key is not set';
        }

        MyWallet.disableLogout(true);
        if (archTimer) {
            clearInterval(archTimer);
            archTimer = null;
        }

        var _errorcallback = function(e) {
            MyWallet.sendEvent('on_backup_wallet_error')

            MyWallet.sendEvent("msg", {type: "error", message: 'Error Saving Wallet: ' + e, platform: ""});

            //Fetch the wallet agin from server
            MyWallet.getWallet();

            if (errorcallback != null)
                errorcallback(e);
        };

        try {
            if (method == null) {
                method = 'update';
            }

            var data = MyWallet.makeWalletJSON();
            localWalletJsonString = data;
            
            //Everything looks ok, Encrypt the JSON output
            var crypted = MyWallet.encryptWallet(data, password);
            
            if (crypted.length == 0) {
                throw 'Error encrypting the JSON output';
            }
            
            //Now Decrypt the it again to double check for any possible corruption
            MyWallet.decryptWallet(crypted, password, function(obj) {
                try {
                    var old_checksum = payload_checksum;
                    MyWallet.sendEvent('on_backup_wallet_start');

                    MyWallet.setEncryptedWalletData(crypted);

                    var new_checksum = payload_checksum;
                    
                    var data =  {
                        length: crypted.length,
                        payload: crypted,
                        checksum: new_checksum,
                        old_checksum : old_checksum,
                        method : method,
                        format : 'plain',
                        language : language
                    };

                    if (sync_pubkeys) {
                        data.active = MyWallet.getLegacyActiveAddresses().join('|');
                    }

                    MyWallet.securePost("wallet", data, function(data) {
                        checkWalletChecksum(new_checksum, function() {
                            for (var key in addresses) {
                                var addr = addresses[key];
                                if (addr.tag == 1) {
                                    delete addr.tag; //Make any unsaved addresses as saved
                                }
                            }

                            if (successcallback != null)
                                successcallback();

                            isSynchronizedWithServer = true;
                            MyWallet.disableLogout(false);
                            logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
                            MyWallet.sendEvent('on_backup_wallet_success')
                        }, function() {
                            _errorcallback('Checksum Did Not Match Expected Value')
                            MyWallet.disableLogout(false);
                        });
                    }, function(e) {
                        _errorcallback(e.responseText);
                        MyWallet.disableLogout(false);
                    });
                } catch (e) {
                    _errorcallback(e);
                    MyWallet.disableLogout(false);
                };
            });
        } catch (e) {
            _errorcallback(e);
            MyWallet.disableLogout(false);
        }
    }

    this.isBase58 = function(str, base) {
        for (var i = 0; i < str.length; ++i) {
            if (str[i] < 0 || str[i] > 58) {
                return false;
            }
        }
        return true;
    }

    this.encrypt = function(data, password, pbkdf2_iterations) {
      var salt = CryptoJS.lib.WordArray.random(16)      
      var streched_password = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: pbkdf2_iterations })
            
      var iv = salt // Use the same value for IV and salt.
        
      var payload = CryptoJS.enc.Utf8.parse(data)
        
      // AES.encrypt takes an optional salt argument, which we don't use.
      var encrypted = CryptoJS.AES.encrypt(payload, streched_password, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Iso10126, iv: iv}); 
                        
      // Add IV to beginning of payload (using hex strings):                                 
      var res = iv.toString() + encrypted.ciphertext.toString();
      
      // Return as Base64:
      return CryptoJS.enc.Hex.parse(res).toString(CryptoJS.enc.Base64)
    }

    this.encryptWallet = function(data, password) {
        // Disabled by Sjors on 2014-11-28 for lack of a test wallet.
        // if (encryption_version_used == 2.0) {
        //     return JSON.stringify({
        //         pbkdf2_iterations : MyWallet.getMainPasswordPbkdf2Iterations(),
        //         version : encryption_version_used,
        //         payload : MyWallet.encrypt(data, password, MyWallet.getMainPasswordPbkdf2Iterations())
        //     });
        // } else
        // if (encryption_version_used == 0.0) {
            return MyWallet.encrypt(data, password, MyWallet.getDefaultPbkdf2Iterations());
        // } else {
        //     throw 'Unknown encryption version ' + encryption_version_used;
        // }
    }

    this.decryptWallet = function(data, password, success, error) {
        try {
            MyWallet.sendEvent("msg", {type: "info", message: 'Decrypting Wallet', platform: "iOS"});

            MyWallet.sendEvent('on_wallet_decrypt_start')

            var _success = function (root, obj) {
                MyWallet.sendEvent('on_wallet_decrypt_finish')

                if (success != null) {
                    success(root, obj);
                }
            }

            var _error = function (e) {
                MyWallet.sendEvent('on_wallet_decrypt_finish')

                if (error != null) {
                    error(e);
                }
            }

            //Test if the payload is valid json
            //If it is json then check the payload and pbkdf2_iterations keys are available
            var obj = null;
            try {
                var obj = $.parseJSON(data);
            } catch (e) {}
            
            var decryptNormal = function() {
                try {
                    var decrypted = decryptAesWithStretchedPassword(obj.payload, password, obj.pbkdf2_iterations);
                    // CryptoJS.AES.decrypt(obj.payload, password, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Iso10126, iterations : obj.pbkdf2_iterations});
                    var root = $.parseJSON(decrypted);
            
                    _success(root, obj);
                } catch (e) {
                    _error('Error Decrypting Wallet. Please check your password is correct.');
                    MyWallet.sendEvent("msg", {type: "info", message: 'Error Decrypting Wallet. Please check your password is correct.', platform: "iOS"});
                }
            };
            
            if (obj && obj.payload && obj.pbkdf2_iterations) {
                if (obj.version != supported_encryption_version)
                    throw 'Wallet version ' + obj.version + ' not supported';
            
                if (obj.pbkdf2_iterations > 0) {
                    MyWallet.decryptWebWorker(obj.payload, password, obj.pbkdf2_iterations, function(decrypted) {
            
                        try {
                            var root = $.parseJSON(decrypted);
            
                            _success(root, obj);
                        } catch (e) {
                            decryptNormal();
                        }
                    }, function(e) {
            
                        decryptNormal();
                    });
                } else {
                    decryptNormal();
                }
            } else {
              MyWallet.decrypt(data, password, MyWallet.getDefaultPbkdf2Iterations(), function(decrypted) {
                    try {
                        var root = $.parseJSON(decrypted);

                        try {
                            _success(root);
                        }  catch (e) {
                            console.log(e);
                        }
                        return true;
                    } catch (e) {
                        return false;
                    }
                }, function() {
                    _error('Error Decrypting Wallet. Please check your password is correct.');
                    MyWallet.sendEvent("msg", {type: "info", message: 'Error Decrypting Wallet. Please check your password is correct.', platform: "iOS"});
                });
            }
        } catch (e) {
            _error(e);
        }
    }

    this.getWebWorkerLoadPrefix = function() {
        return BlockchainAPI.getRootURL() + resource + 'wallet/';
    }

    this.decryptWebWorker = function(data, password, pbkdf2_iterations, success, _error) {
        var didError = false;
        var error = function(e) {
            if (!didError) { _error(e); didError = true; }
        }

        try {
            var worker = new Worker(MyWallet.getWebWorkerLoadPrefix() + 'signer' + (min ? '.min.js' : '.js'));

            worker.addEventListener('message', function(e) {
                var data = e.data;

                try {
                    switch (data.cmd) {
                        case 'on_decrypt':
                            success(data.data);
                            worker.terminate();
                            break;
                        case 'on_error': {
                            throw data.e;
                        }
                    };
                } catch (e) {
                    worker.terminate();
                    error(e);
                }
            }, false);

            worker.addEventListener('error', function(e) {
                error(e);
            });

            worker.postMessage({cmd : 'load_resource' , path : MyWallet.getWebWorkerLoadPrefix() + 'bitcoinjs' + (min ? '.min.js' : '.js')});

            worker.postMessage({cmd : 'decrypt', data : data, password : password, pbkdf2_iterations : pbkdf2_iterations});
        } catch (e) {
            error(e);
        }
    }

    //When the ecryption format changes it can produce data which appears to decrypt fine but actually didn't
    //So we call success(data) and if it returns true the data was formatted correctly
    this.decrypt = function(data, password, pbkdf2_iterations, success, error) {
        //iso10126 with pbkdf2_iterations iterations
     
        try {
            /* This is currently (2014-11-28) the default wallet format. 
               There are two steps to decrypting the wallet. The first step is to
               stretch the users password using PBKDF2. This essentially generates
               an AES key which we need for the second step, which is to decrypt 
               the payload using AES.

               Strechting the password requires a salt. AES requires an IV. We use 
               the same for both. It's the first 32 hexadecimals characters (i.e. 
               16 bytes).
          
               The conversions between different encodings can probably be achieved
               with fewer methods.
            */
        
            var decoded = decryptAesWithStretchedPassword(data, password, pbkdf2_iterations);
            
            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        
        } catch (e) {
            console.log(e);
        }
        
        //iso10126 with 10 iterations  (old default)
        if (pbkdf2_iterations != 10) {
            try {
                var streched_password = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: 10 })
              
                var decrypted = CryptoJS.AES.decrypt({ciphertext: payload, salt: ""}, streched_password, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Iso10126, iv: iv}); 
        
                var decoded = decrypted.toString(CryptoJS.enc.Utf8)
              
                if (decoded != null && decoded.length > 0) {
                    if (success(decoded)) {
                        return decoded;
                    };
                };
            } catch (e) {
                console.log(e);
            }
        }

        //Otherwise try the old default settings
        
        // Disabled by Sjors on 2014-11-26, for lack of test wallet.
        
        // try {
        //     var decoded = CryptoJS.AES.decrypt(data, password);
        //
        //     if (decoded != null && decoded.length > 0) {
        //         if (success(decoded)) {
        //             return decoded;
        //         };
        //     };
        // } catch (e) {
        //     console.log(e);
        // }

        //OFB iso7816 padding with one iteration (old default)
        
        // Disabled by Sjors on 2014-11-26, because the current CryptoJS doesn't support iso7816. 
               
        // try {
        //     var decoded = CryptoJS.AES.decrypt(data, password, {mode: new CryptoJS.mode.OFB(CryptoJS.pad.Iso7816), iterations : 1});
        //
        //     if (decoded != null && decoded.length > 0) {
        //         if (success(decoded)) {
        //             return decoded;
        //         };
        //     };
        // } catch (e) {
        //     console.log(e);
        // }

        //iso10126 padding with one iteration (old default)
        try {
            var decoded = CryptoJS.AES.decrypt(data, password, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Iso10126, iterations : 1 });

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        if (error) error();

        return null;
    }

    this.decryptPasswordWithProcessedPin = function(data, password, pbkdf2_iterations) {
        return decryptAesWithStretchedPassword(data, password, pbkdf2_iterations);
    }

    function decryptAesWithStretchedPassword(data, password, pbkdf2_iterations) {
        // Convert base64 string data to hex string
        var data_hex_string = CryptoJS.enc.Base64.parse(data).toString()
        
        // Pull out the Initialization vector from data (@see http://en.wikipedia.org/wiki/Initialization_vector )
        var iv = CryptoJS.enc.Hex.parse(data_hex_string.slice(0,32))
        
        // We use same value for the PBKDF2 salt and the AES IV. But we do not use a salt in the AES encryption
        var salt = iv
        
        // Stretch the password using PBKDF2:
        var streched_password = CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations: pbkdf2_iterations })
        
        // Remove the first 16 bytes (IV) from the payload:
        var payload_hex_string = data_hex_string.slice(32)
        
        // Paylod is cipthertext without IV as bytes
        var payload = CryptoJS.enc.Hex.parse(payload_hex_string)
        
        // AES decryption expects a base 64 encoded payload:
        var payload_base_64 = payload.toString(CryptoJS.enc.Base64)
        
        // AES.decrypt takes an optional salt argument, which we don't use.
        var decrypted = CryptoJS.AES.decrypt({ciphertext: payload, salt: ""}, streched_password, { mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Iso10126, iv: iv});
        
        // Decrypted is returned as bytes, we convert it to a UTF8 String
        var decoded = decrypted.toString(CryptoJS.enc.Utf8)
        
        return decoded;
    }
    
    this.handleNTPResponse = function(obj, clientTime) {
        //Calculate serverTimeOffset using NTP alog
        var nowTime = (new Date()).getTime();
        if (obj.clientTimeDiff && obj.serverTime) {
            var serverClientResponseDiffTime = nowTime - obj.serverTime;
            var responseTime = (obj.clientTimeDiff - nowTime + clientTime - serverClientResponseDiffTime) / 2;

            var thisOffset = (serverClientResponseDiffTime - responseTime) / 2;

            if (haveSetServerTime) {
                serverTimeOffset = (serverTimeOffset + thisOffset) / 2;
            } else {
                serverTimeOffset = thisOffset;
                haveSetServerTime = true;
                MyStore.put('server_time_offset', ''+serverTimeOffset);
            }

            console.log('Server Time offset ' + serverTimeOffset + 'ms - This offset ' + thisOffset);
        }
    }

    this.encryptPK = function(base58) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot encrypt private key without a password';

            return MyWallet.encrypt(base58, sharedKey + dpassword, MyWallet.getSecondPasswordPbkdf2Iterations());
        } else {
            return base58;
        }

        return null;
    }

    function encodePK(priv) {
        var base58 = Bitcoin.base58.encode(priv.toBuffer(32));

        return MyWallet.encryptPK(base58);
    }

    this.decryptPK = function(priv) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot decrypt private key without a password';

            return MyWallet.decrypt(priv, sharedKey + dpassword, MyWallet.getSecondPasswordPbkdf2Iterations(), MyWallet.isBase58);
        } else {
            return priv;
        }

        return null;
    }

    this.decodePK = function(priv) {
        if (!priv) throw 'null PK passed to decodePK';

        var decrypted = MyWallet.decryptPK(priv);
        if (decrypted != null) {
            return MyWallet.B58LegacyDecode(decrypted);
        }
        return null;
    }

    this.signmessage = function(address, message) {
        var addr = addresses[address];

        if (!addr.priv)
            throw 'Cannot sign a watch only address';

        var decryptedpk = MyWallet.decodePK(addr.priv);

        var key = new ECKey(new BigInteger.fromBuffer(decryptedpk), false);
        if (key.pub.getAddress().toString() != address) {
            key = new ECKey(new BigInteger.fromBuffer(decryptedpk), true);
        }

        var signatureBuffer = Bitcoin.Message.sign(key, message, Bitcoin.networks.bitcoin);
        return signatureBuffer.toString("base64", 0, signatureBuffer.length);
    }

    this.validateSecondPassword = function(input) {
        var thash = CryptoJS.SHA256(sharedKey + input);

        var password_hash = hashPassword(thash, MyWallet.getSecondPasswordPbkdf2Iterations()-1);  //-1 because we have hashed once in the previous line

        if (password_hash == dpasswordhash) {
            dpassword = input;
            return true;
        }

        //Try 10 rounds
        if (MyWallet.getSecondPasswordPbkdf2Iterations() != 10) {
            var iter_10_hash = hashPassword(thash, 10-1);  //-1 because we have hashed once in the previous line

            if (iter_10_hash == dpasswordhash) {
                dpassword = input;
                dpasswordhash = password_hash;
                return true;
            }
        }

        /*
        //disable old crypto stuff
        //Otherwise try SHA256 + salt
        if (Crypto.util.bytesToHex(thash) == dpasswordhash) {
            dpassword = input;
            dpasswordhash = password_hash;
            return true;
        }

        //Legacy as I made a bit of a mistake creating a SHA256 hash without the salt included
        var leghash = Crypto.SHA256(input);

        if (leghash == dpasswordhash) {
            dpassword = input;
            dpasswordhash = password_hash;
            return true;
        }
        //*/

        return false;
    }

    this.runCompressedCheck = function() {
        var to_check = [];
        var key_map = {};

        for (var key in addresses) {
            var addr = addresses[key];

            if (addr.priv != null) {
                var decryptedpk = MyWallet.decodePK(addr.priv);

                var privatekey = new ECKey(new BigInteger.fromBuffer(decryptedpk), false);

                var uncompressed_address = MyWallet.getUnCompressedAddressString(privatekey);
                var compressed_address = MyWallet.getCompressedAddressString(privatekey);

                var isCompressed = false;
                if (addr.addr != uncompressed_address) {
                    key_map[uncompressed_address] = addr.priv;
                    to_check.push(uncompressed_address);
                }

                if (addr.addr != compressed_address) {
                    key_map[compressed_address] = addr.priv;
                    to_check.push(compressed_address);
                    isCompressed = true;
                }
            }
        }

        if (to_check.length == 0) {
            alert('to_check length == 0');
        }

        BlockchainAPI.get_balances(to_check, function(results) {
            var total_balance = 0;
            for (var key in results) {
                var balance = results[key].final_balance;
                if (balance > 0) {
                    var ecKey = new ECKey(new BigInteger.fromBuffer(MyWallet.decodePK(key_map[key])), isCompressed);

                    var address = ecKey.getBitcoinAddress().toString();

                    if (MyWallet.addPrivateKey(ecKey, {compressed : address != key, app_name : IMPORTED_APP_NAME, app_version : IMPORTED_APP_VERSION})) {
                        alert(formatBTC(balance) + ' claimable in address ' + key);
                    }
                }
                total_balance += balance;
            }

            alert(formatBTC(total_balance) + ' found in compressed addresses');

            if (total_balance > 0) {
                MyWallet.backupWallet('update', function() {
                    MyWallet.get_history();
                });
            }
        });
    }

    //Check the integreity of all keys in the wallet
    this.checkAllKeys = function(reencrypt) {
        for (var key in addresses) {
            var addr = addresses[key];

            if (addr.addr == null)
                throw 'Null Address Found in wallet ' + key;

            //Will throw an exception if the checksum does not validate
            if (addr.addr.toString() == null)
                throw 'Error decoding wallet address ' + addr.addr;

            if (addr.priv != null) {

                var decryptedpk = MyWallet.decodePK(addr.priv);

                var privatekey = new ECKey(new BigInteger.fromBuffer(decryptedpk), false);

                var actual_addr = MyWallet.getUnCompressedAddressString(privatekey);
                if (actual_addr != addr.addr && MyWallet.getCompressedAddressString(privatekey) != addr.addr) {
                    throw 'Private key does not match bitcoin address ' + addr.addr + " != " + actual_addr;
                }

                if (reencrypt) {
                    addr.priv = encodePK(decryptedpk);
                }
            }
        }

        MyWallet.sendEvent("msg", {type: "success", message: 'wallet-success ' + 'Wallet verified.', platform: ""});
    }

    this.changePassword = function(new_password, success, error) {
        password = new_password;
        MyWallet.backupWallet('update', function() {
            if (success)
                success();
        }, function() {
            if (error)
                error();
        });
    }

    this.setMainPassword = function(new_password) {
        MyWallet.getMainPassword(function() {
            password = new_password;

            MyWallet.backupWallet('update', function() {
                MyWallet.logout();
            }, function() {
                MyWallet.logout();
            });
        });
    }

    this.createNewWallet = function(inputedEmail, inputedPassword, languageCode, currencyCode, success, error) {
        MyWalletSignup.generateNewWallet(inputedPassword, inputedEmail, function(createdGuid, createdSharedKey, createdPassword) {
            MyStore.clear();
            if (languageCode)
                MyWallet.setLanguage(languageCode);
            if (currencyCode)
                MyWallet.setLocalSymbolCode(currencyCode);

            success(createdGuid, createdSharedKey, createdPassword);
        }, function (e) {
            error(e);
        });
    }

    function nKeys(obj) {
        var size = 0, key;
        for (key in obj) {
            size++;
        }
        return size;
    };

    function walletIsFull() {
        if (nKeys(addresses) >= maxAddr) {
            MyWallet.sendEvent("msg", {type: "error", message: 'We currently support a maximum of '+maxAddr+' private keys, please remove some unused ones.', platform: ""});
            return true;
        }

        return false;
    }

//Address (String), priv (base58 String), compresses boolean
    function internalAddKey(addr, priv) {
        var existing = addresses[addr];
        if (!existing || existing.length == 0) {
            addresses[addr] = {addr : addr, priv : priv, balance : null};
            return true;
        } else if (!existing.priv && priv) {
            existing.priv = priv;
            return true;
        }
        return false;
    }

    this.logout = function() {
        if (disable_logout)
            return;

        MyWallet.sendEvent('logging_out')

        if (guid == demo_guid) {
            window.location = BlockchainAPI.getRootURL() + 'wallet/logout';
        } else {
            $.ajax({
                type: "GET",
                timeout: 60000,
                url: BlockchainAPI.getRootURL() + 'wallet/logout',
                data : {format : 'plain', api_code : MyWallet.getAPICode()},
                success: function(data) {
                    window.location.reload();
                },
                error : function() {
                    window.location.reload();
                }
            });
        }
    }

    this.openWindow = function(url) {
        function _hasPopupBlocker(poppedWindow) {
            var result = false;

            try {
                if (typeof poppedWindow == 'undefined' || !poppedWindow) {
                    // Safari with popup blocker... leaves the popup window handle undefined
                    result = true;
                }
                else if (poppedWindow && poppedWindow.closed) {
                    // This happens if the user opens and closes the client window...
                    // Confusing because the handle is still available, but it's in a "closed" state.
                    // We're not saying that the window is not being blocked, we're just saying
                    // that the window has been closed before the test could be run.
                    result = false;
                }
                else if (poppedWindow && poppedWindow.test) {
                    // This is the actual test. The client window should be fine.
                    result = false;
                }
            } catch (err) {
                //if (console) {
                //    console.warn("Could not access popup window", err);
                //}
            }

            return result;
        }

        window.open(url, null, "scroll=1,status=1,location=1,toolbar=1");

        if (_hasPopupBlocker(window)) {
            MyWallet.sendEvent("msg", {type: "error", message: "Popup Blocked. Try and click again.", platform: ""});
            return false;
        } else {
            return true;
        }
    }

    function parseMiniKey(miniKey) {
        var check = Crypto.SHA256(miniKey + '?');

        switch(check.slice(0,2)) {
            case '00':
                var decodedKey = Crypto.SHA256(miniKey, {asBytes: true});
                return decodedKey;
                break;
            case '01':
                var x          = Crypto.util.hexToBytes(check.slice(2,4))[0];
                var count      = Math.round(Math.pow(2, (x / 4)));
                var decodedKey = Crypto.PBKDF2(miniKey, 'Satoshi Nakamoto', 32, { iterations: count, asBytes: true});
                return decodedKey;
                break;
            default:
                console.log('invalid key');
                break;
        }
    };

    this.detectPrivateKeyFormat = function(key) {
        // 51 characters base58, always starts with a '5'
        if (/^5[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50}$/.test(key))
            return 'sipa';

        //52 character compressed starts with L or K
        if (/^[LK][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{51}$/.test(key))
            return 'compsipa';

        // 52 characters base58
        if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(key) || /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{43}$/.test(key))
            return 'base58';

        if (/^[A-Fa-f0-9]{64}$/.test(key))
            return 'hex';

        if (/^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=+\/]{44}$/.test(key))
            return 'base64';

        if (/^6P[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{56}$/.test(key))
            return 'bip38';

        if (/^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{21}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{25}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{29}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{30}$/.test(key)) {

            var testBytes = Crypto.SHA256(key + "?", { asBytes: true });

            if (testBytes[0] === 0x00 || testBytes[0] === 0x01)
                return 'mini';
        }

        throw 'Unknown Key Format ' + key;
    }

    this.privateKeyStringToKey = function(value, format) {
        var key_bytes = null;
        var compressed = null;

        if (format == 'base58') {
            key_bytes = BigInteger.fromBuffer(Bitcoin.base58.decode(value)).toByteArray();
            compressed = false;
        } else if (format == 'base64') {
            key_bytes = Crypto.util.base64ToBytes(value);
        } else if (format == 'hex') {
            key_bytes = Crypto.util.hexToBytes(value);
        } else if (format == 'mini') {
            key_bytes = parseMiniKey(value);
        } else if (format == 'sipa') {
            var tbytes = BigInteger.fromBuffer(Bitcoin.base58.decode(value)).toByteArray();
            tbytes.shift(); //extra shift cuz BigInteger.fromBuffer prefixed extra 0 byte to array
            tbytes.shift();
            key_bytes = tbytes.slice(0, tbytes.length - 4);

        } else if (format == 'compsipa') {
            var tbytes = BigInteger.fromBuffer(Bitcoin.base58.decode(value)).toByteArray();
            tbytes.shift(); //extra shift cuz BigInteger.fromBuffer prefixed extra 0 byte to array
            tbytes.shift();
            tbytes.pop();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else {
            throw 'Unsupported Key Format';
        }

        if (key_bytes.length != 32 && key_bytes.length != 33)
            throw 'Result not 32 or 33 bytes in length';

        if (compressed == null)
            compressed = (format == 'sipa') ? false : true;
        return new ECKey(new BigInteger.fromByteArrayUnsigned(key_bytes), compressed);
    }
};
