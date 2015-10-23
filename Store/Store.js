'use strict';

var React = require('react-native')
var {
  AsyncStorage
} = React

var Reflux = require('reflux');
var Actions = require('../Actions/Actions');
var extend = require('extend');
var Q = require('q');
var AddressBook = require('NativeModules').AddressBook;
var sampleData = require('../data/data');
var voc = require('../data/models');

var myIdentity = require('../data/myIdentity.json');
var welcome = require('../data/welcome.json');

var sha = require('stable-sha1');
var utils = require('../utils/utils');
var level = require('react-native-level')
var promisify = require('q-level');

var constants = require('tradle-constants');
var NONCE = constants.NONCE
var TYPE = constants.TYPE
var ROOT_HASH = constants.ROOT_HASH
var CUR_HASH  = constants.CUR_HASH
var ORGANIZATION = constants.TYPES.ORGANIZATION
var IDENTITY = constants.TYPES.IDENTITY
var MESSAGE = constants.TYPES.MESSAGE

var Tim = require('tim')
var getDHTKey = require('tim/lib/utils').getDHTKey

var dns = require('dns')
var map = require('map-stream')
var leveldown = require('asyncstorage-down')
var DHT = require('bittorrent-dht') // use tradle/bittorrent-dht fork
var Blockchain = require('cb-blockr') // use tradle/cb-blockr fork
var midentity = require('midentity')
var Identity = midentity.Identity
var defaultKeySet = midentity.defaultKeySet
var Keeper = require('http-keeper')
var Wallet = require('simple-wallet')
var crypto = require('crypto')
var rimraf = require('rimraf')
var fs = require('fs')
var kiki = require('kiki')
var Keys = kiki.Keys

var tutils = require('tradle-utils')
var ChainedObj = require('chained-obj');
var Builder = ChainedObj.Builder;
var Parser = ChainedObj.Parser;

// var billPriv = require('../TiMTests/fixtures/bill-priv.json');
// var billPub = require('../TiMTests/fixtures/bill-pub.json');

var isTest, originalMe;

// var tim;
var PORT = 51086

// var levelQuery = require('level-queryengine');
// var jsonqueryEngine = require('jsonquery-engine');
// var Device = require('react-native-device');
// var Sublevel = require('level-sublevel')
var IDENTITY_MODEL = constants.TYPES.IDENTITY;

var ADDITIONAL_INFO = 'tradle.AdditionalInfo';
var VERIFICATION = 'tradle.Verification';
var MODEL_TYPE_VALUE = 'tradle.Model';
var MY_IDENTITIES_MODEL = 'tradle.MyIdentities';
var TIM_PATH_PREFIX = 'me'

var models = {};
var list = {};
var employees = {};
var db;
var ldb;
var isLoaded;
var me;
var meDriver;
var meIdentity
var ready;
var networkName = 'testnet'

var Store = Reflux.createStore({
  // this will set up listeners to all publishers in TodoActions, using onKeyname (or keyname) as callbacks
  listenables: [Actions],
  // this will be called by all listening components as they register their listeners
  init() {
    // Setup components:
    var ldb = level('TiM.db', { valueEncoding: 'json' });
    // ldb = levelQuery(level('TiM.db', { valueEncoding: 'json' }));
    // ldb.query.use(jsonqueryEngine());
    db = promisify(ldb);

    // var sdb = promisify(Sublevel(ldb));
    // identityDb = sdb.sublevel(IDENTITY_MODEL);
    // return this.onReloadDB()
    // this.loadModels()
    var self = this
    
    // this.ready = Q.ninvoke(AsyncStorage, 'clear')
    // .then(this.loadMyResources.bind(this))
    this.ready = this.loadMyResources()
    .then(function() {
      if (!utils.isEmpty(list))
        isLoaded = true;
      if (me) {
        return promiseMe()
      }
    })
    .catch(function(err) {
      err = err;
    });

    function promiseMe () {
      return self.getDriver(me)
        .then(function () {
          self.loadResources()
          return self.initIdentity(me)
        })
    }
  },
  createFromIdentity(r) {
    var rr = {};
    if (r.name) {
      for (var p in r.name)
        rr[p] = r.name[p];
    }
    if (r.location) {
      for (var p in r.location)
        rr[p] = r.location[p];
    }
    for (var p in r)
      if (p !== 'name' && p !== 'location')
        rr[p] = r[p];
    return rr;
  },

  buildDriver(identity, keys, port) {
    var iJSON = identity.toJSON()
    // var prefix = iJSON.name.firstName.toLowerCase()
    var dht = this.dhtFor(iJSON)
    dht.listen(port)

    var keeper = new Keeper({
      // storage: prefix + '-storage',
      storeOnFetch: true,
      storage: 'storage',
      fallbacks: ['http://tradle.io:25667']
    })

    var blockchain = new Blockchain(networkName)

    return Q.ninvoke(dns, 'resolve4', 'tradle.io')
      .then(function (addrs) {
        console.log('tradle is at', addrs)
        return meDriver = new Tim({
          pathPrefix: TIM_PATH_PREFIX,
          networkName: networkName,
          keeper: keeper,
          blockchain: blockchain,
          leveldown: leveldown,
          identity: identity,
          identityKeys: keys,
          dht: dht,
          port: port,
          syncInterval: 60000,
          relay: {
            address: addrs[0],
            port: 25778
          }
        })
      })

    // var log = d.log;
    // d.log = function () {
    //   console.log('log', arguments);
    //   return log.apply(this, arguments);
    // }

    // return d
  },
  dhtFor (identity) {
    return new DHT({
      nodeId: this.nodeIdFor(identity),
      bootstrap: ['tradle.io:25778']
    })
  },
  nodeIdFor (identity) {
    return crypto.createHash('sha256')
      .update(this.findKey(identity.pubkeys, { type: 'dsa' }).fingerprint)
      .digest()
      .slice(0, 20)
  },
  findKey (keys, where) {
    var match
    keys.some(function (k) {
      for (var p in where) {
        if (k[p] !== where[p]) return false
      }

      match = k
      return true
    })

    return match
  },
  onStart() {
    var self = this;
    this.ready.then(function() {
      self.trigger({
        action: 'start',
        models: models,
        me: me});
    });
  },

  onAddMessage(r, isWelcome) {
    var props = this.getModel(r[TYPE]).value.properties;
    var rr = {};
    if (!r.time)
      r.time = new Date().getTime();

    for (var p in r) {
      if (props[p].ref  &&  !props[p].id) {
        var type = r[p][TYPE];
        var id = type ? type + '_' + r[p][ROOT_HASH]/* + '_' + r[p][CUR_HASH]*/ : r[p].id;
        var title = type ? utils.getDisplayName(r[p], this.getModel(type).value.properties) : r[p].title
        rr[p] = {
          id: id,
          title: title,
          time: r.time
        }
      }
      else
        rr[p] = r[p];
    }

    rr[NONCE] = this.getNonce()
    var toChain = {
      _t: rr[TYPE],
      _z: rr[NONCE],
    }
    if (rr.message)
      toChain.message = rr.message        
    if (rr.photos)
      toChain.photos = rr.photos

    var batch = []
    var self = this
    var error
    var welcomeMessage;
    return getDHTKey(toChain)
    .then(function(dhtKey) {
      // var key = rr[TYPE] + '_' + dhtKey;
      if (!isWelcome) {
        rr[ROOT_HASH] = dhtKey;
        // rr[CUR_HASH] = dhtKey;
        // batch.push({type: 'put', key: key, value: rr})
        // list[key] = {key: key, value: rr};
        var to = list[utils.getId(r.to)].value;
        var from = list[utils.getId(r.from)].value;
        var dn = r.message; // || utils.getDisplayName(r, props);
        if (!dn)
          dn = 'sent photo';
        else {
          var msgParts = utils.splitMessage(dn);
          dn = msgParts.length === 1 ? dn : utils.getModel(msgParts[1]).value.title + ' request';
        }

        to.lastMessage = (from[ROOT_HASH] === me[ROOT_HASH]) ? 'You: ' + dn : dn;
        to.lastMessageTime = rr.time;
        from.lastMessage = rr.message;
        from.lastMessageTime = r.time;
        batch.push({type: 'put', key: to[TYPE] + '_' + to[ROOT_HASH], value: to});
        batch.push({type: 'put', key: from[TYPE] + '_' + from[ROOT_HASH], value: from});
      }
      if (!isWelcome  ||  (me.organization  &&  utils.getId(me.organization) === utils.getId(r.to)))
        return Q()
      var wmKey = 'Welcome' + rr.to.title
      if (list[wmKey]) {
        list[wmKey].value.time = new Date()
        return Q()
      }
      // Create welcome message without saving it in DB
      welcomeMessage = {}
      welcomeMessage.message = welcome.msg.replace('{firstName}', me.firstName)
      welcomeMessage.time = new Date()
      welcomeMessage[TYPE] = constants.TYPES.SIMPLE_MESSAGE
      welcomeMessage[NONCE] = self.getNonce()
      welcomeMessage.to = {
        id: me[TYPE] + '_' + me[ROOT_HASH],
        title: utils.getDisplayName(me, self.getModel(constants.TYPES.IDENTITY).value.properties)
      }
      welcomeMessage.from = {
        id: rr.to.id,
        title: rr.to.title,
        time: rr.to.time
      }
      welcomeMessage.organization = {
        id: rr.to.id,
        title: rr.to.title,
        time: rr.to.time
      }
      welcomeMessage[ROOT_HASH] = wmKey
      list[welcomeMessage[ROOT_HASH]] = {
        key: welcomeMessage[ROOT_HASH],
        value: welcomeMessage
      }
      return Q()
    })
    .then(function() {
    //   if (batch.length)
    //     return db.batch(batch)
    //   // error = 'You have a low balance'
    // })
    // .then(function() {
    //   var params = {
    //     action: 'addMessage',
    //     resource: isWelcome ? welcomeMessage : rr
    //   }
    //   if (error) 
    //     params.error = error
      
    //   self.trigger(params);

      if (batch.length  &&  !error) 
        return self.getDriver(me)
    })
    .then(function() {
      if (!isWelcome)
        return meDriver.send({
          msg: toChain,
          to: [{fingerprint: self.getFingerprint(r.to)}],
          deliver: true,
          chain: false
        })
    })
    .then(function(data) {
      if (!data) 
        return Q()
      var roothash = data[0]._props[ROOT_HASH]
      rr[ROOT_HASH] = roothash
      rr[CUR_HASH] = data[0]._props[CUR_HASH]

      var key = rr[TYPE] + '_' + roothash;
      batch.push({type: 'put', key: key, value: rr})
      list[key] = {key: key, value: rr};
      return db.batch(batch)
    })
    .then(function() {
      var params = {
        action: 'addMessage',
        resource: isWelcome ? welcomeMessage : rr
      }
      if (error) 
        params.error = error
      
      self.trigger(params);

      // if (batch.length  &&  !error) 
      //   return self.getDriver(me)
    })

    // .then(function() {
    //   self.trigger({
    //     action: 'addMessage',
    //     resource: isWelcome ? welcomeMessage : rr
    //   });
    // })
    .catch(function(err) {
      err = err;
    });
  },
  onAddVerification(r, notOneClickVerification) {
    var batch = [];
    var key;
    var fromId = utils.getId(r.from);
    var isVerification = r[TYPE] === VERIFICATION;
    var from = list[fromId].value;

    r[NONCE] = this.getNonce()

    var toChain = {
      _t: r[TYPE],
      _z: r[NONCE],
    }
    if (r[ROOT_HASH]) {
      toChain[CUR_HASH] = r[ROOT_HASH]
      r[CUR_HASH] = r[ROOT_HASH]
    }
    return (getDHTKey(toChain))
    .then(function(dhtKey) {
      var rootHash = r[ROOT_HASH]
      r[ROOT_HASH] = rootHash
      key = r[TYPE] + '_' + rootHash;

      if (from.organization)
        r.organization = from.organization;

      r.time = new Date().getTime();
      batch.push({type: 'put', key: key, value: r});

      var toId = utils.getId(r.to);
      var verificationRequestId = utils.getId(r.document);
      var to = list[toId].value;
      r.time = r.time || new Date().getTime();

      var newVerification = {
        id: key + '_' + r[CUR_HASH],
        title: r.document.title ? r.document.title : '',
        time: r.time
      };
      var verificationRequest = list[verificationRequestId].value;
      if (!verificationRequest.verifiedBy)
        verificationRequest.verifications = [];
      verificationRequest.verifications.push(newVerification);

      if (!from.myVerifications)
        from.myVerifications = [];

      from.myVerifications.push(newVerification);
      if (!to.verifiedByMe)
        to.verifiedByMe = [];
      to.verifiedByMe.push(newVerification);

      batch.push({type: 'put', key: verificationRequestId, value: verificationRequest});
      // batch.push({type: 'put', key: toId, value: to});
      batch.push({type: 'put', key: fromId, value: from});
      var self = this;
     
    // check if send returns somewhere roothash for the new resource
      return db.batch(batch)
    })
    .then(function() {
      var rr = {};
      extend(rr, to);
      rr.verifiedByMe = r;
      list[key] = {key: key, value: r};

      if (notOneClickVerification)
        self.trigger({action: 'addItem', resource: rr});
      else
        self.trigger({action: 'addVerification', resource: rr});
      return meDriver.send({
        msg: r,
        to: [{fingerprint: this.getFingerprint(r.to)}],
        deliver: true,
        chain: false
      })
    })
    .then(function(data) {
      var d = data
    })
    .catch(function(err) {
      err = err
    })
  },
  onGetTo(key) {
    this.onGetItem(key, 'getTo');
  },
  onGetFrom(key) {
    this.onGetItem(key, 'getFrom');
  },
  onGetItem(key, action) {
    var resource = {};
    extend(resource, list[utils.getId(key)].value);
    var props = this.getModel(resource[TYPE]).value.properties;
    for (var p in props) {
      if (p.charAt(0) === '_')
        continue;
      var items = props[p].items;
      if (!items  ||  !items.backlink)
        continue;
      var backlink = items.backlink;
      var itemsModel = this.getModel(items.ref).value;
      var params = {
        modelName: items.ref,
        to: resource,
        meta: itemsModel,
        props: itemsModel.properties
      }
      var result = this.searchNotMessages(params);
      if (result.length)
        resource[p] = result;
    }
    this.trigger({ resource: resource, action: action || 'getItem'});
  },
  onShowIdentityList() {
    if (sampleData.getMyId()) {
      this.trigger({action: 'showIdentityList', list: []});
      return;
    }
    var allIdentities = list[MY_IDENTITIES_MODEL + '_1'].value.allIdentities;
    var meId = me[TYPE] + '_' + me[ROOT_HASH];
    var result = [];
    if (allIdentities) {
      for (var id of allIdentities)
        if (id.id != meId) {
          var resource = {};
          if (list[id.id].value.canceled)
            continue;
          extend(resource, list[id.id].value);
          result.push(resource);
        }
    }
    this.trigger({action: 'showIdentityList', list: result});
  },

  getItem(resource) {
    var modelName = resource[TYPE];
    var meta = this.getModel(modelName).value;
    var foundRefs = [];
    var refProps = this.getRefs(resource, foundRefs, meta.properties);
    var self = this;
    var newResource = {};
    extend(newResource, resource);
    for (var i=0; i<foundRefs.length; i++) {
     // foundRefs.forEach(function(val) {
       var val = foundRefs[i];
       if (val.state === 'fulfilled') {
         var propValue = val.value[TYPE] + '_' + val.value[ROOT_HASH];
         var prop = refProps[propValue];
         newResource[prop] = val.value;
         newResource[prop].id = val.value[TYPE] + '_' + val.value[ROOT_HASH];
         if (!newResource[prop].title)
            newResource[prop].title = utils.getDisplayName(newResource, meta);
       }
     }
     return newResource;
  },
  getDependencies(resultList) {
    var self = this;
    var newResult = resultList.map(function(resource) {
      return self.getItem(resource);
    });
    return newResult;
  },
  getRefs(resource, foundRefs, props) {
    var refProps = [];
    for (var p in resource) {
      if (props[p] &&  props[p].type === 'object') {
        var ref = props[p].ref;
        if (ref  &&  resource[p]) {
          var rValue;
          // reference property could be set as a full resource (for char to have all info at hand when displaying the message)
          // or resource id
          if (resource[p][ROOT_HASH])
            rValue = resource[p][TYPE] + '_' + resource[p][ROOT_HASH];
          else
            rValue = utils.getId(resource[p]);

          refProps[rValue] = p;
          if (list[rValue]) {
            var elm = {value: list[rValue].value, state: 'fulfilled'};
            foundRefs.push(elm);
          }
        }
      }
    }
    return refProps;
  },
  onAddModelFromUrl(url) {
    var self = this;
    var model, props;
    return fetch(url)
    .then((response) => response.json())
    .then(function(responseData) {
      model = responseData;
      props = model.properties;

      var err = '';
      var id = model.id;

      if (!id)
        err += '"id" is required. Could be something like "myGithubId.nameOfTheModel"';
      var key = id;
      // if (models[key])
      //   err += '"id" is not unique';
      var message = model.message;
      var from = props.from;
      if (!from)
        err += '"from" is required. Should have {ref: "tradle.Identity"}';

      var to = props.to;
      if (!to)
        err += '"to" is required. Should have {ref: "tradle.Identity"}';
      var time = props.time;
      if (!time)
        err += '"time" is required';

      if (err.length) {
        self.trigger({action: 'newModelAdded', err: err});
        return;
      }
      model.interfaces = [];
      model.interfaces.push(MESSAGE);
      var rootHash = sha(model);
      model[ROOT_HASH] = rootHash;
      model[constants.OWNER] = {
        key: IDENTITY_MODEL + '_' + me[ROOT_HASH],
        title: utils.getDisplayName(me, self.getModel(IDENTITY_MODEL).value.properties),
        photos: me.photos
      }
      // Wil need to publish new model
      return db.put(key, model);
    })
    .then(function() {
      if (!me.myModels)
        me.myModels = [];
      var key = model.id;
      me.myModels.push({key: key, title: model.title});

      self.setPropertyNames(props);

      models[key] = {
        key: key,
        value: model
      };
      self.trigger({action: 'newModelAdded', newModel: model});
    })
    .catch(function(err) {
      err = err;
    })
    .done();
  },
  setPropertyNames(props) {
    for (var p in props) {
      if (!props[p].name)
        props[p].name = p;
      if (!props[p].title)
        props[p].title = utils.makeLabel(p);
    }
  },
  onAddItem(params) {
    var value = params.value;
    var resource = params.resource;
    var meta = params.meta;
    var isRegistration = params.isRegistration;
    var additionalInfo = params.additionalInfo;
    // Check if there are references to other resources
    var refProps = {};
    var promises = [];
    var foundRefs = [];
    var props = meta.properties;
    if (meta[TYPE] == VERIFICATION  ||  (meta.subClassOf  &&  meta.subClassOf == VERIFICATION))
      return this.onAddVerification(resource, true);

    for (var p in resource) {
      if (props[p] &&  props[p].type === 'object') {
        var ref = props[p].ref;
        if (ref  &&  resource[p])  {
          if (props[p].ref  &&  this.getModel(props[p].ref).value.inlined)
            continue;
          var rValue = resource[p][ROOT_HASH] ? resource[p][TYPE] + '_' + resource[p][ROOT_HASH] : utils.getId(resource[p].id);
          refProps[rValue] = p;
          if (list[rValue]) {
            var elm = {value: list[rValue].value, state: 'fulfilled'};
            foundRefs.push(elm);
          }
          else
            promises.push(Q.ninvoke(db, 'get', rValue));
        }
      }
    }
    // Add items properties if they were created
    var json = JSON.parse(JSON.stringify(value));
    for (p in resource) {
      if (props[p]  &&  props[p].type === 'array')
        json[p] = resource[p];
    }
    if (!json[TYPE])
      json[TYPE] = meta.id;
    var error = this.checkRequired(json, props);
    if (error) {
      foundRefs.forEach(function(val) {
        var propValue = val.value[TYPE] + '_' + val.value[ROOT_HASH];
        var prop = refProps[propValue];
        json[prop] = val.value;
      });

      this.trigger({
        action: 'addItem',
        // list: list,
        resource: json,
        error: error
      });
      return;
    }
    // if (error) {
    //   this.listenables[0].addItem.failed(error);
    //   return;
    // }
    var self = this;
    var returnVal
    var identity
    var isNew = !resource[ROOT_HASH];
    Q.allSettled(promises)
    .then(function(results) {
      extend(foundRefs, results);
      foundRefs.forEach(function(val) {
        if (val.state === 'fulfilled') {
          var value = val.value;
          var propValue = value[TYPE] + '_' + value[ROOT_HASH];
          var prop = refProps[propValue];

          var title = utils.getDisplayName(value, self.getModel(value[TYPE]).value.properties);
          json[prop] = {
            title: title,
            id: propValue  + '_' + value[CUR_HASH],
            time: value.time
          }
          var interfaces = meta.interfaces;
          if (interfaces  &&  interfaces.indexOf(MESSAGE) != -1)
            json.time = new Date().getTime();
        }
      });
      if (isNew  &&  !resource.time)
        resource.time = new Date().getTime();

      if (!resource  ||  isNew) 
        returnVal = json
      else {
        returnVal = {};
        extend(true, returnVal, resource);
        for (var p in json)
          if (!returnVal[p])
            returnVal[p] = json[p];
          else if (!props[p].readOnly  &&  !props[p].immutable)
            returnVal[p] = json[p];
      }
      if (!isRegistration)
        returnVal[NONCE] = self.getNonce()
      if (returnVal[ROOT_HASH])
        return returnVal[ROOT_HASH]
      else
        return isRegistration ? self.loadDB() : Q()
    })
    .then(function() {
      if (isRegistration) {
        return self.getDriver(returnVal)
      }
      else
        return Q()
    })
    .then(function() {
      if (isRegistration) {
        // identity = new Identity()
        //   .name({
        //     firstName: returnVal.firstName,
        //     formatted: returnVal.firstName + (returnVal.lastName ? ' ' + returnVal.lastName : '')            
        //   })
        //   .set('_z', returnVal[NONCE])

        // returnVal.pubkeys.forEach(identity.addKey, identity)

        // var publishingIdentity = identity.toJSON()

        return getDHTKey(meIdentity.toJSON())    
      }
      return getDHTKey(returnVal)    
    })
    .then(function (dhtKey) {
      if (!resource  ||  isNew)
        returnVal[ROOT_HASH] = dhtKey
      return self._putResourceInDB(returnVal[TYPE], returnVal, dhtKey, isRegistration);
    })
    .catch(function(err) {
      err = err
    })

  },

  checkRequired(resource, meta) {
    var type = resource[TYPE];
    var rootHash = resource[ROOT_HASH];
    var oldResource = (rootHash) ? list[type + '_' + rootHash] : null;
    var required = meta.required;
    if (!required)
      return;
    for (var i=0; i<required.length; i++) {
      var prop = required[i];
      if (!resource[prop] && (!oldResource || !oldResource[prop]))
        return 'Please add "' + meta.properties[prop].title + '"';
    }
  },
  onReloadDB() {
    var togo = 1;
    // this.loadModels()
    // var name = me.firstName.toLowerCase();
    var self = this
    meDriver.destroy()
    .then(function() {
      meDriver = null

      rimraf('./', finish)
      ;[
        'addressBook.db',
        // 'msg-log.db',
        'messages.db',
        'txs.db'
      ].forEach(function (dbName) {
        ;[name].forEach(function (name) {
          togo++
          leveldown.destroy(TIM_PATH_PREFIX + '-' + dbName, finish)
        })
      })

      function finish () {
        if (--togo === 0)  {
          isLoaded = false;
          self.onReloadDB1()
        }
      }
    })
  },
  onMessageList(params) {
    this.onList(params);
  },
  onList(params) {
    if (isLoaded)
      this.getList(params);
    else {
      var self = this;
      this.loadDB()
      .then(function() {
        isLoaded = true;
        if (params.modelName)
          self.getList(params);
      });
    }
  },
  getList(params) { //query, modelName, resource, isAggregation, prop) {
    var result = this.searchResources(params);
    if (params.isAggregation)
      result = this.getDependencies(result);
    var resultList = [];
    for (var r of result) {
      var rr = {};
      extend(rr, r);
      resultList.push(rr);
    }
    var model = this.getModel(params.modelName).value;
    var isMessage = model.isInterface  ||  (model.interfaces  &&  model.interfaces.indexOf(MESSAGE) != -1);
    var verificationsToShare;
    if (isMessage  &&  !params.isAggregation)
      verificationsToShare = this.getVerificationsToShare(result, params.to);
    var retParams = {
      action: isMessage  &&  !params.prop ? 'messageList' : 'list',
      list: resultList,
      isAggregation: params.isAggregation
    }
    if (verificationsToShare)
      retParams.verificationsToShare = verificationsToShare;
    if (params.prop)
      retParams.prop = params.prop;

    this.trigger(retParams);
  },
  searchResources(params) {
    var meta = this.getModel(params.modelName).value;
    var isMessage = meta.isInterface  ||  (meta.interfaces  &&  meta.interfaces.indexOf(MESSAGE) != -1);
    if (isMessage)
      return this.searchMessages(params);
    else
      return this.searchNotMessages(params);
  },
  searchNotMessages(params) {
    var foundResources = {};
    var modelName = params.modelName;
    var to = params.to;
    var meta = this.getModel(modelName).value;
    var props = meta.properties;
    var containerProp, resourceId;
    // to variable if present is a container resource as for example subreddit for posts or post for comments
    // if to is passed then resources only of this container need to be returned
    if (to) {
      for (var p in props) {
        if (props[p].ref  &&  props[p].ref === to[TYPE]) {
          containerProp = p;
          resourceId = to[TYPE] + '_' + to[ROOT_HASH];
        }
      }
    }
    var query = params.query;

    var required = meta.required;
    var meRootHash = me  &&  me[ROOT_HASH];
    var meId = IDENTITY_MODEL + '_' + meRootHash;
    var subclasses = utils.getAllSubclasses(modelName).map(function(r) {
      return r.id
    })

    for (var key in list) {
      if (key.indexOf(modelName + '_') == -1) {
        if (subclasses) {
          var s = key.split('_')[0]
          if (subclasses.indexOf(s) === -1) 
            continue;
        }
        else
          continue;
      }
      var r = list[key].value;
      if (r.canceled)
        continue;
      // if (r[constants.OWNER]) {
      //   var id = utils.getId(r[constants.OWNER]);
      //   if (id != me[TYPE] + '_' + me[ROOT_HASH])
      //     continue;
      // }
      if (containerProp  &&  (!r[containerProp]  ||  utils.getId(r[containerProp]) !== resourceId))
        continue;
      if (!query) {
         foundResources[key] = r;
         continue;
       }
       // primitive filtering for this commit
       var combinedValue = '';
       for (var rr in props) {
         if (r[rr] instanceof Array)
          continue;
         combinedValue += combinedValue ? ' ' + r[rr] : r[rr];
       }
       if (!combinedValue  ||  (combinedValue  &&  (!query || combinedValue.toLowerCase().indexOf(query.toLowerCase()) != -1))) {
         foundResources[key] = r;
       }
    }
    // Don't show current 'me' contact in contact list or my identities list
    var isIdentity = modelName === IDENTITY_MODEL;
    if (!containerProp  &&  me  &&  isIdentity) {
      if (sampleData.getMyId())
        delete foundResources[IDENTITY_MODEL + '_' + me[ROOT_HASH]];
      else if (!isTest) {
        var myIdentities = list[MY_IDENTITIES_MODEL + '_1'].value.allIdentities;
        for (var meId of myIdentities) {
          if (foundResources[meId.id])
             delete foundResources[meId.id];
        }
      }
    }

    var result = utils.objectToArray(foundResources);
    if (isIdentity) {
      result.forEach(function(r) {
        if (r.organization) {
          var photos = list[utils.getId(r.organization.id)].value.photos;
          if (photos)
            r.organization.photo = photos[0].url;
        }
      });
    }

    var sortProp = params.sortProperty;
    if (sortProp) {
      var asc = (typeof params.asc != 'undefined') ? params.asc : false;
      if (props[sortProp].type == 'date') {
        result.sort(function(a,b) {
          var aVal = a[sortProp] ? a[sortProp] : 0;
          var bVal = b[sortProp] ? b[sortProp] : 0;
          if (asc)
            return new Date(aVal) - new Date(bVal);
          else
            return new Date(bVal) - new Date(aVal);
        });
      }
      else if (props[sortProp].type == 'string')  {
        result.sort();
        if (asc)
          result.reverse();
      }
      else if (props[sortProp].type == 'number') {
        result.sort(function(a, b) {
          return asc ? a - b : b - a
        });
      }
    }
    return result;
  },
  searchMessages(params) {
    var query = params.query;
    var modelName = params.modelName;
    var meta = this.getModel(modelName).value;
    var isVerification = modelName === VERIFICATION  ||  (meta.subClassOf  &&  meta.subClassOf === VERIFICATION);
    var chatTo = params.to;
    var prop = params.prop;
    if (typeof prop === 'string')
      prop = meta[prop];
    var backlink = prop ? prop.items.backlink : prop;
    var foundResources = {};
    var isAllMessages = meta.isInterface;
    var props = meta.properties;

    var implementors = isAllMessages ? utils.getImplementors(modelName) : null;

    var required = meta.required;
    var meRootHash = me  &&  me[ROOT_HASH];
    var meId = IDENTITY_MODEL + '_' + meRootHash;
    var meOrgId = me.organization ? utils.getId(me.organization) : null;

    var chatId = chatTo ? chatTo[TYPE] + '_' + chatTo[ROOT_HASH] : null;
    var isChatWithOrg = chatTo  &&  chatTo[TYPE] === ORGANIZATION;
    if (isChatWithOrg  &&  !chatTo.name) {
      chatTo = list[chatId].value;
    }
    var testMe = chatTo ? chatTo.me : null;
    if (testMe) {
      if (testMe === 'me') {
        if (!originalMe)
          originalMe = me;
        testMe = originalMe[ROOT_HASH];
      }

      isTest = true;
      var meId = constants.TYPES.IDENTITY + '_' + testMe;
      me = list[meId].value;
      utils.setMe(me);
      var myIdentities = list[MY_IDENTITIES_MODEL + '_1'].value;
      if (myIdentities)
        myIdentities.currentIdentity = meId;
    }
    var toModelName = chatTo ? chatId.split('_')[0] : null;
    for (var key in list) {
      var iMeta = null;
      if (isAllMessages) {
        if (implementors) {
          for (var impl of implementors) {
            if (impl.id.indexOf(key.substring(0, key.indexOf('_'))) === 0) {
              iMeta = impl;
              break;
            }
          }
          if (!iMeta)
            continue;
        }
      }
      else if (key.indexOf(modelName + '_') === -1) {
        var rModel = this.getModel(key.split('_')[0]).value;
        if (!rModel.subClassOf  ||  rModel.subClassOf !== modelName)
          continue;
      }
      if (!iMeta)
        iMeta = meta;
      var r = list[key].value;
      if (r.canceled)
        continue;
      // Make sure that the messages that are showing in chat belong to the conversation between these participants
      if (isVerification) {
        if (r.organization) {
          if (!r.organization.photos) {
            var orgPhotos = list[utils.getId(r.organization.id)].value.photos;
            if (orgPhotos)
              r.organization.photos = [orgPhotos[0]];
          }
        }
        if (r.document  &&  r.document.id)
          r.document = list[utils.getId(r.document.id)].value;
      }
      if (chatTo) {
        if (backlink  &&  r[backlink]) {
          if (chatId === utils.getId(r[backlink]))
            foundResources[key] = r;

          continue;
        }
        var isVerificationR = r[TYPE] === VERIFICATION  ||  r[TYPE].subClassOf === VERIFICATION;
        if ((!r.message  ||  r.message.trim().length === 0) && !r.photos &&  !isVerificationR)
          // check if this is verification resource
          continue;
        var fromID = utils.getId(r.from);
        var toID = utils.getId(r.to);

        if (fromID !== meId  &&  toID !== meId  &&  toID != meOrgId)
          continue;
        var id = toModelName + '_' + chatTo[ROOT_HASH];
        if (isChatWithOrg) {
          var toOrgId = null, fromOrgId = null;

          if (list[fromID].value.organization)
            fromOrgId = utils.getId(list[fromID].value.organization);
          else if (fromID.split('_')[0] === ORGANIZATION)
            fromOrgId = utils.getId(list[fromID].value);
          if (list[toID].value.organization)
            toOrgId = utils.getId(list[toID].value.organization);
          else if (toID.split('_')[0] === ORGANIZATION)
            toOrgId = utils.getId(list[toID].value);

          if (chatId !== toOrgId  &&  chatId !== fromOrgId)
            continue;
          if (fromID != meId  &&  toID != meId)
            continue
        }
        else if (fromID !== id  &&  toID != id  &&  toID != meOrgId)
          continue;
      }
      if (isVerificationR  ||  r[TYPE] === ADDITIONAL_INFO) {
        var doc = {};
        extend(true, doc, list[utils.getId(r.document)].value);
        delete doc.verifications;
        delete doc.additionalInfo;
        r.document = doc;
      }

      if (!query) {
        // foundResources[key] = r;
        var msg = this.fillMessage(r);
        if (msg)
          foundResources[key] = msg;
        continue;
      }
       // primitive filtering for this commit
      var combinedValue = '';
      for (var rr in props) {
        if (r[rr] instanceof Array)
         continue;
        combinedValue += combinedValue ? ' ' + r[rr] : r[rr];
      }
      if (!combinedValue  ||  (combinedValue  &&  (!query || combinedValue.toLowerCase().indexOf(query.toLowerCase()) != -1))) {
        foundResources[key] = this.fillMessage(r);
      }
    }

    var result = utils.objectToArray(foundResources);

    // find possible verifications for the requests that were not yet fulfilled from other verification providers

    result.sort(function(a,b) {
      // Turn your strings into dates, and then subtract them
      // to get a value that is either negative, positive, or zero.
      return new Date(a.time) - new Date(b.time);
    });
    // not for subreddit
    for (var r of result) {
      r.from.photos = list[utils.getId(r.from)].value.photos;
      r.to.photos = list[utils.getId(r.to)].value.photos;
    }
    return result;
  },
  searchMessages1(params) {
    var query = params.query;
    var modelName = params.modelName;
    var meta = this.getModel(modelName).value;
    var isVerification = modelName === constants.TYPES.VERIFICATION  ||  (meta.subClassOf  &&  meta.subClassOf === constants.TYPES.VERIFICATION);
    var chatTo = params.to;
    var prop = params.prop;
    if (typeof prop === 'string')
      prop = meta[prop];
    var backlink = prop ? prop.items.backlink : prop;
    var foundResources = {};
    var isAllMessages = meta.isInterface;
    var props = meta.properties;

    var implementors = isAllMessages ? utils.getImplementors(modelName) : null;

    var required = meta.required;
    var meRootHash = me  &&  me[ROOT_HASH];
    var meId = IDENTITY_MODEL + '_' + meRootHash;
    var meOrgId = me.organization ? utils.getId(me.organization) : null;

    var chatId = chatTo ? chatTo[TYPE] + '_' + chatTo[ROOT_HASH] : null;
    var isChatWithOrg = chatTo  &&  chatTo[TYPE] === constants.TYPES.ORGANIZATION;
    if (isChatWithOrg  &&  !chatTo.name) {
      chatTo = list[chatId].value;
    }
    var testMe = chatTo ? chatTo.me : null;
    if (testMe) {
      if (testMe === 'me') {
        if (!originalMe)
          originalMe = me;
        testMe = originalMe[ROOT_HASH];
      }

      isTest = true;
      var meId = constants.TYPES.IDENTITY + '_' + testMe;
      me = list[meId].value;
      utils.setMe(me);
      var myIdentities = list[MY_IDENTITIES_MODEL + '_1'].value;
      if (myIdentities)
        myIdentities.currentIdentity = meId;
    }
    var toModelName = chatTo ? chatId.split('_')[0] : null;
    for (var key in list) {
      var iMeta = null;
      if (isAllMessages) {
        if (implementors) {
          for (var impl of implementors) {
            if (impl.id.indexOf(key.substring(0, key.indexOf('_'))) === 0) {
              iMeta = impl;
              break;
            }
          }
          if (!iMeta)
            continue;
        }
      }
      else if (key.indexOf(modelName + '_') === -1) {
        var rModel = this.getModel(key.split('_')[0]).value;
        if (!rModel.subClassOf  ||  rModel.subClassOf !== modelName)
          continue;
      }
      if (!iMeta)
        iMeta = meta;
      var r = list[key].value;
      if (r.canceled)
        continue;
      // Make sure that the messages that are showing in chat belong to the conversation between these participants
      if (isVerification) {
        if (r.organization) {
          if (!r.organization.photos) {
            var orgPhotos = list[utils.getId(r.organization.id)].value.photos;
            if (orgPhotos)
              r.organization.photos = [orgPhotos[0]];
          }
        }
        if (r.document  &&  r.document.id)
          r.document = list[utils.getId(r.document.id)].value;
      }
      if (chatTo) {
        if (backlink  &&  r[backlink]) {
          if (chatId === utils.getId(r[backlink]))
            foundResources[key] = r;

          continue;
        }
        var isVerificationR = r[TYPE] === VERIFICATION  ||  r[TYPE].subClassOf === VERIFICATION;
        if ((!r.message  ||  r.message.trim().length === 0) && !r.photos &&  !isVerificationR)
          // check if this is verification resource
          continue;
        var fromID = utils.getId(r.from);
        var toID = utils.getId(r.to);

        if (fromID !== meId  &&  toID !== meId  &&  toID != meOrgId)
          continue;
        var id = toModelName + '_' + chatTo[ROOT_HASH];
        if (isChatWithOrg) {
          var toOrgId = null, fromOrgId = null;

          if (list[fromID].value.organization)
            fromOrgId = utils.getId(list[fromID].value.organization);
          else if (fromID.split('_')[0] === ORGANIZATION)
            fromOrgId = utils.getId(list[fromID].value);
          if (list[toID].value.organization)
            toOrgId = utils.getId(list[toID].value.organization);
          else if (toID.split('_')[0] === ORGANIZATION)
            toOrgId = utils.getId(list[toID].value);

          if (chatId !== toOrgId  &&  chatId !== fromOrgId)
            continue;
          if (fromID != meId  &&  toID != meId)
            continue
        }
        else if (fromID !== id  &&  toID != id  &&  toID != meOrgId)
          continue;
      }
      if (isVerificationR  ||  r[TYPE] === ADDITIONAL_INFO) {
        var doc = {};
        extend(true, doc, list[utils.getId(r.document)].value);
        delete doc.verifications;
        delete doc.additionalInfo;
        r.document = doc;
      }

      if (!query) {
        // foundResources[key] = r;
        var msg = this.fillMessage(r);
        if (msg)
          foundResources[key] = msg;
        continue;
      }
       // primitive filtering for this commit
      var combinedValue = '';
      for (var rr in props) {
        if (r[rr] instanceof Array)
         continue;
        combinedValue += combinedValue ? ' ' + r[rr] : r[rr];
      }
      if (!combinedValue  ||  (combinedValue  &&  (!query || combinedValue.toLowerCase().indexOf(query.toLowerCase()) != -1))) {
        foundResources[key] = this.fillMessage(r);
      }
    }

    var result = utils.objectToArray(foundResources);

    // find possible verifications for the requests that were not yet fulfilled from other verification providers

    result.sort(function(a,b) {
      // Turn your strings into dates, and then subtract them
      // to get a value that is either negative, positive, or zero.
      return new Date(a.time) - new Date(b.time);
    });
    // not for subreddit
    for (var r of result) {
      r.from.photos = list[utils.getId(r.from)].value.photos;
      r.to.photos = list[utils.getId(r.to)].value.photos;
    }
    return result;
  },
  fillMessage(r) {
    var resource = {};
    extend(resource, r);
    if (!r.verifications  ||  !r.verifications.length)
      return resource;
    for (var i=0; i<resource.verifications.length; i++) {
      var v = resource.verifications[i];
      var vId = v.id ? utils.getId(v.id) : v[TYPE] + '_' + v[ROOT_HASH];
      var ver = {};
      extend(ver, list[vId].value);
      resource.verifications[i] = ver;
      if (ver.organization  &&  !ver.organization.photos) {
        var orgPhotos = list[utils.getId(ver.organization.id)].value.photos;
        if (orgPhotos)
          ver.organization.photo = orgPhotos[0].url;
      }
      // resource.time = ver.time;
    }
    return resource;
  },
  getVerificationsToShare(foundResources, to) {
    var verTypes = [];
    var meId = me[TYPE] + '_' + me[ROOT_HASH];
    for (var i=0; i<foundResources.length; i++) {
      var r = foundResources[i];
      if (me  &&  utils.getId(r.to) !== meId)
        continue;
      if (r[TYPE] !== 'tradle.SimpleMessage'  ||  r.verifications)
        continue;
      var msgParts = utils.splitMessage(r.message);
      // Case when the needed form was sent along with the message
      if (msgParts.length !== 2)
        continue;
      var msgModel = utils.getModel(msgParts[1]);
      if (msgModel)
        verTypes.push(msgModel.value.id);
    }
    var verificationsToShare = {};
    if (!verTypes.length)
      return;

    for (var key in list) {
      var type = key.split('_')[0];
      var model = utils.getModel(type).value;
      if (model.id !== VERIFICATION && (!model.subClassOf  ||  model.subClassOf !== VERIFICATION))
        continue;

      var doc = list[key].value.document;
      var docType = (doc.id && doc.id.split('_')[0]) || doc[TYPE];
      if (verTypes.indexOf(docType) === -1)
        continue;
      var val = list[key].value;
      var id = utils.getId(val.to.id);
      if (id === meId) {
        var document = doc.id ? list[utils.getId(doc.id)].value : doc;
        if (to  &&  to.organization  &&  document.verifications) {
          var thisCompanyVerification;
          for (var i=0; i<document.verifications.length; i++) {
            var v = document.verifications[i];
            if (v.organization  &&  utils.getId(to.organization) === utils.getId(v.organization)) {
              thisCompanyVerification = true;
              break;
            }
          }
          if (thisCompanyVerification)
            continue;
        }
        var value = {};
        extend(value, list[key].value);
        value.document = document;
        var v = verificationsToShare[docType];
        if (!v)
          verificationsToShare[docType] = [];
        verificationsToShare[docType].push(value);
      }
    }
    return verificationsToShare;
  },
  getNonce() {
    return crypto.randomBytes(32).toString('hex')
  },
  _putResourceInDB(modelName, value, dhtKey, isRegistration) {
    // Cleanup null form values
    for (var p in value) {
      if (!value[p])
        delete value[p];
    }
    if (!value[TYPE])
      value[TYPE] = modelName;
    
    var isNew = !value[ROOT_HASH]
    value[CUR_HASH] = isNew ? dhtKey : value[ROOT_HASH]
    var model = this.getModel(modelName).value;
    var props = model.properties;
    var batch = [];
    if (isNew) {
      var creator =  me
                  ?  me
                  :  isRegistration ? value : null;
      if (creator) {
        value[constants.OWNER] = {
          id: IDENTITY_MODEL + '_' + creator[ROOT_HASH] + '_' + creator[CUR_HASH],
          title: utils.getDisplayName(me, this.getModel(IDENTITY_MODEL))
        };
      }

      if (value[TYPE] === ADDITIONAL_INFO) {
        var verificationRequest = value.document;

        var vrId = utils.getId(verificationRequest);
        var vr = list[vrId].value;
        if (!vr.additionalInfo  ||  !vr.additionalInfo.length)
          vr.additionalInfo = [];
        vr.additionalInfo.push({
          id: ADDITIONAL_INFO + '_' + value[ROOT_HASH],
          title: value.message,
          time: value.time
        });
        batch.push({type: 'put', key: vrId, value: vr});
      }
    }
    value.time = new Date().getTime();

    // if (model.isInterface  ||  (model.interfaces  &&  model.interfaces.indexOf(MESSAGE) != -1)) {
    var isMessage = model.subClassOf  &&  model.subClassOf === constants.TYPES.MESSAGE;
    if (isMessage) {
      if (props['to']  &&  props['from']) {
        var to = list[utils.getId(value.to)].value;
        var from = list[utils.getId(value.from)].value;
        var dn = value.message || utils.getDisplayName(value, props);
        to.lastMessage = (from[ROOT_HASH] === me[ROOT_HASH]) ? 'You: ' + dn : dn;
        to.lastMessageTime = value.time;
        from.lastMessage = value.message;
        from.lastMessageTime = value.time;
        batch.push({type: 'put', key: to[TYPE] + '_' + to[ROOT_HASH], value: to});
        batch.push({type: 'put', key: from[TYPE] + '_' + from[ROOT_HASH], value: from});
      }
    }
    var iKey = modelName + '_' + value[ROOT_HASH];
    batch.push({type: 'put', key: iKey, value: value});

    var mid;

    // send message to blockchain
    if (isMessage) {
      to = list[utils.getId(value.to)].value;

      var toChain = {
        _t: rr[TYPE],
        _z: rr[NONCE],
      }
      if (value.message)
        toChain.message = value.message        
      if (value.photos)
        toChain.photos = value.photos

      meDriver.send({
        msg: value,
        to: this.getFingerprint(to),
        deliver: true,
        chain: true
      })
    }
    var self = this;
    if (isRegistration) {
      this.registration(value)
      return
    }

    db.batch(batch)
    .then(function() {
      return db.get(iKey)
    })
    .then(function(value) {
      list[iKey] = {key: iKey, value: value};
      if (mid)
        list[MY_IDENTITIES_MODEL + '_1'] = {key: MY_IDENTITIES_MODEL + '_1', value: mid};
      return self.loadDB(db);
    })
    .then(function() {
      var  params = {action: 'addItem', resource: value};
      // registration or profile editing
      self.trigger(params);
    })
    .catch(function(err) {
      err = err;
    });
  },
  registration(value) {
    var self = this
    isLoaded = true;
    me = value
    // meDriver = null
    var iKey = value[TYPE] + '_' + value[ROOT_HASH];
    var batch = [];
    batch.push({type: 'put', key: iKey, value: value});
    var mid = {
      _type: MY_IDENTITIES_MODEL,
      currentIdentity: iKey,
      allIdentities: [{
        id: iKey,
        title: utils.getDisplayName(value, models[value[TYPE]].value.properties),
        privkeys: me.privkeys
      }]};
    batch.push({type: 'put', key: MY_IDENTITIES_MODEL + '_1', value: mid});///
    return db.batch(batch)
    // .then(function() {
    //   return self.getDriver(value)
    // })
    .then(function () {
      self.loadResources();
      return self.initIdentity(me)
    })
    .then(function() {
      return db.get(iKey)
    })
    .then(function(value) {
      list[iKey] = {key: iKey, value: value};
      if (mid)
        list[MY_IDENTITIES_MODEL + '_1'] = {key: MY_IDENTITIES_MODEL + '_1', value: mid};
      return self.loadDB(db);
    })
    .then(function() {
      var  params = {action: 'addItem', resource: value, me: value};
      self.trigger(params);
    })
    .catch(function(err) {
      err = err;
    });
  },
  setOrg(value) {
  // var org = list[utils.getId(value.organization)].value
    var result = this.searchNotMessages({modelName: 'tradle.SecurityCode'})
    if (!result) {
      var err = 'The security code you specified was not registered with ' + value.organization.title
      this.trigger({action: 'addItem', resource: value, error: err})
      return
    }

    var i = 0
    for (; i<result.length; i++) {
      if (result[i].code === value.securityCode) {
        value.organization = result[i].organization
        break
      }
    }
    if (!value.organization) {
      var err = 'The security code you specified was not registered with ' + value.organization.title
      this.trigger({action: 'addItem', resource: value, error: err})
      return
    }

    // var org = list[utils.getId(value.organization)].value

    var photos = list[utils.getId(value.organization.id)].value.photos;
    if (photos)
      value.organization.photo = photos[0].url;
  },

  getFingerprint(r) {
    var pubkeys = r.pubkeys
    if (!pubkeys) {
      // Choose any employee from the company to send the notification about the customer
      if (r[TYPE] === ORGANIZATION) {
        var secCodes = this.searchNotMessages({modelName: 'tradle.SecurityCode', to: r})
        var employees = this.searchNotMessages({modelName: IDENTITY, prop: 'organization', to: r})

        if (employees) {
          var codes = [];
          secCodes.forEach(function(sc) {
            codes.push(sc.code)
          })
          for (var i=0; i<employees.length; i++) {
            if (employees[i].securityCode && codes.indexOf(employees[i].securityCode) != -1) {
              pubkeys = employees[i].pubkeys
              if (pubkeys)
                break
            }
          }
        }
      }
    }
    if (pubkeys) {
      for (var i=0; i<pubkeys.length; i++) {
        var key = pubkeys[i]
        if (key.purpose === 'sign'  &&  key.type === 'ec')
          return key.fingerprint
      }
    }
  },
  getDriver(me) {
    if (meDriver)
      return Q.resolve(meDriver)
    var allMyIdentities = list[MY_IDENTITIES_MODEL + '_1']

    var mePub = me['pubkeys']    
    var mePriv;
    if (!allMyIdentities)
      mePriv = me['privkeys']
    else {
      var all = allMyIdentities.value.allIdentities
      var curId = allMyIdentities.value.currentIdentity
      all.forEach(function(id) {
        if (id.id === curId)
          mePriv = id.privkeys
      })      
    }
    if (!mePub  &&  !mePriv) {
      if (!me.securityCode) {
        for (var i=0; i<myIdentity.length  &&  !mePub; i++) {
          if (!myIdentity[i].securityCode  &&  me.firstName === myIdentity[i].firstName) {
            mePub = myIdentity[i].pubkeys  // hardcoded on device
            mePriv = myIdentity[i].privkeys
            me[NONCE] = myIdentity[i][NONCE]            
          }
        }
      }
      else {
        myIdentity.forEach(function(r) {
          if (r.securityCode === me.securityCode) {
            mePub = r.pubkeys  // hardcoded on device
            mePriv = r.privkeys          
            me[NONCE] = r[NONCE]
          }
        })

        if (!mePub) {
          // var org = list[utils.getId(me.organization)].value
          var secCodes = this.searchNotMessages({modelName: 'tradle.SecurityCode'})
          for (var i=0; i<secCodes.length; i++) {
            if (secCodes[i].code === me.securityCode) {
              me.organization = secCodes[i].organization
              if (employees[me.securityCode])
                employees[me.securityCode] = me
              break
            }
          }
          if (!me.organization) {
            this.trigger({action:'addItem', resource: me, error: 'The code was not registered with'})
            return Q.reject('The code was not registered with')
          }
        }
      }
      if (!mePub) {
        var keys = defaultKeySet({
          networkName: 'testnet'
        })
        mePub = []
        mePriv = []
        keys.forEach(function(key) {
          mePriv.push(key.exportPrivate())
          mePub.push(key.exportPublic())
        })
      }
      me['pubkeys'] = mePub
      me['privkeys'] = mePriv
    }

    meIdentity = new Identity()
                        .name({
                          firstName: me.firstName,
                          formatted: me.firstName + (me.lastName ? ' ' + me.lastName : '')            
                        })
                        .set('_z', me[NONCE] || this.getNonce())

    me.pubkeys.forEach(meIdentity.addKey, meIdentity)

    var publishingIdentity = meIdentity.toJSON()

    return this.buildDriver(Identity.fromJSON(publishingIdentity), mePriv, PORT)
  },

  initIdentity(me) {
    return this.getDriver(me)
    .then(function () {
      return meDriver.identityPublishStatus()
    })
    .then(function(status) {
      if (!status.queued  &&  !status.current)
        return Q.ninvoke(meDriver.wallet, 'balance')
    })
    .then(function(balance) {
      if (balance)
        return meDriver.publishMyIdentity()
    })
    .catch(function(err) {
      err = err
    })
  },
  loadAddressBook() {
    return Q();
    var self = this;
    return Q.ninvoke(AddressBook, 'checkPermission')
    .then(function(permission) {
      // AddressBook.PERMISSION_AUTHORIZED || AddressBook.PERMISSION_UNDEFINED || AddressBook.PERMISSION_DENIED
      if(permission === AddressBook.PERMISSION_UNDEFINED)
        return Q.ninvoke(AddressBook, 'requestPermission')
               .then(function(permission) {
                 if (permission === AddressBook.PERMISSION_AUTHORIZED)
                   return self.storeContacts.bind(self);
               });
      else if (permission === AddressBook.PERMISSION_AUTHORIZED)
        return self.storeContacts()
      else if (permission === AddressBook.PERMISSION_DENIED) {
        //handle permission denied
        return Q();
      }
    })
  },
  storeContacts() {
    var dfd = Q.defer();
    var self = this;
    var batch = [];
    var props = models[IDENTITY_MODEL].value.properties;
    AddressBook.getContacts(function(err, contacts) {
      contacts.forEach(function(contact) {
        var contactInfo = [];
        var newIdentity = {
          firstName: contact.firstName,
          lastName: contact.lastName,
          // formatted: contact.firstName + ' ' + contact.lastName,
          contactInfo: contactInfo
        };
        newIdentity[TYPE] = IDENTITY_MODEL;
        var me = list[MY_IDENTITIES_MODEL + '_1'];
        if (me)  {
          var currentIdentity = me.value.currentIdentity;
          newIdentity[constants.OWNER] = {id: currentIdentity, title: utils.getDisplayName(me, props)};
          if (me.organization) {
            var photos = list[utils.getId(me.organization.id)].value.photos;
            if (photos)
              me.organization.photo = photos[0].url;
          }
        }

        if (contact.thumbnailPath  &&  contact.thumbnailPath.length)
          newIdentity.photos = [{type: 'address book', url: contact.thumbnailPath}];
        var phoneNumbers = contact.phoneNumbers;
        if (phoneNumbers) {
          phoneNumbers.forEach(function(phone) {
            contactInfo.push({identifier: phone.number, type: phone.label + ' phone'})
          })
        }
        var emailAddresses = contact.emailAddresses;
        if (emailAddresses)
          emailAddresses.forEach(function(email) {
            contactInfo.push({identifier: email.email, type: email.label + ' email'})
          });
        newIdentity[ROOT_HASH] = sha(newIdentity);
        newIdentity[CUR_HASH] = newIdentity[ROOT_HASH];
        var key = IDENTITY_MODEL + '_' + newIdentity[ROOT_HASH];
        if (!list[key])
          batch.push({type: 'put', key: key, value: newIdentity});
      });
      if (batch.length)
        // identityDb.batch(batch, function(err, value) {
        db.batch(batch, function(err, value) {
          if (err)
            dfd.reject(err);
          else {
            self.loadMyResources()
            .then(function() {
              dfd.resolve();
            })
          }
        });
      else
        dfd.resolve();
    })
    return dfd.promise;
  },
  loadResources() {
    var self = this
    meDriver.once('ready', function () {
      console.log(meDriver.name(), 'is ready')
      // d.publishMyIdentity()
      
      meDriver.identities().createReadStream()
      .on('data', function (data) {
        var key = IDENTITY + '_' + data.key
        var val = data.value.identity
        val[ROOT_HASH] = data.value[ROOT_HASH]

        // if (me  &&  val[ROOT_HASH === me[ROOT_HASH]])
        //   return
        
        val[CUR_HASH] = data.value[CUR_HASH]

        var name = val.name;
        delete val.name
        for (var p in name)
          val[p] = name[p]

        db.put(key, val)
        .then(function() {
          list[key] = {
            key: key,
            value: val
          }
          if (val.securityCode) 
            employees[data.value.securityCode] = data.value          
        })
      })
      
      meDriver.messages().createValueStream()
      .on('data', function (data) {
        meDriver.lookupObject(data)
        .then(function (obj) {

          return self.putInDb(obj)
          // console.log('msg', obj)
        })
      })
      // Object was successfully read off chain
      meDriver.on('unchained', function (obj) {
        console.log('unchained', obj)
        meDriver.lookupObject(obj)
        .then(function(obj) {
          return self.putInDb(obj)
        })
      })
      meDriver.on('lowbalance', function () {
        // debugger
        console.log('lowbalance')
      })
      // Object was successfully put on chain but not yet confirmed
      meDriver.on('chained', function (obj) {
        debugger
        console.log('chained', obj)
        meDriver.lookupObject(obj)
        .then(function(obj) {
          obj = obj
          // return putInDb(obj)
        })
      })

      meDriver.on('error', function (err) {
        debugger
        console.log(err)
      })

      meDriver.on('message', function (msg) {
        debugger
        console.log(msg)
        meDriver.lookupObject(msg)
        .then(function(obj) {
          return this.putInDb(obj)
        })
      })
    })
  },
  putInDb(obj) {
    var val = obj.parsed.data
    if (!val)
      return
    val[ROOT_HASH] = obj[ROOT_HASH]
    val[CUR_HASH] = obj[CUR_HASH]
    if (!val.time)
      val.time = obj.timestamp
    var type = val[TYPE]
    var key = type + '_' + val[ROOT_HASH]
    
    var model = utils.getModel(type).value
    var batch = []
    if (model.id == IDENTITY) {      
      // if (!me  ||  obj[ROOT_HASH] !== me[ROOT_HASH]) {
        if (val.name) {
          for (var p in val.name) 
            val[p] = val.name[p]
          delete val.name
        } 
        if (val.location) {
          for (var p in val.location) 
            val[p] = val.location[p]
          delete val.location
        } 

        batch.push({type: 'put', key: key, value: val})
      // }
    }
    else {
      var isMessage = model.isInterface  ||  (model.interfaces  &&  model.interfaces.indexOf(MESSAGE) != -1);
      // var isMessage = model.subClassOf  &&  model.subClassOf === constants.TYPES.MESSAGE
      if (isMessage) {      
        var r = list[key]
        if (!r)
          return
        r = r.value
        var to = list[utils.getId(r.to)].value;
        var from = list[utils.getId(r.from)].value;

        val.to = to
        val.from = from

        var dn = val.message || utils.getDisplayName(val, model.properties);
        to.lastMessage = (from[ROOT_HASH] === me[ROOT_HASH]) ? 'You: ' + dn : dn;
        to.lastMessageTime = val.time;
        from.lastMessage = val.message;
        from.lastMessageTime = val.time;
        batch.push({type: 'put', key: to[TYPE] + '_' + to[ROOT_HASH], value: to});
        batch.push({type: 'put', key: from[TYPE] + '_' + from[ROOT_HASH], value: from});
      }
    }
    // if (batch.length)
      return db.batch(batch)
      .then(function() {
        list[key] = {
          key: key,
          value: val
        }
        var retParams = {
          action: isMessage ? 'addMessage' : 'addItem',
          resource: val
        }
        self.trigger(params)
      })

  },
  loadMyResources() {
    var myId = sampleData.getMyId();
    if (myId)
      myId = IDENTITY_MODEL + '_' + myId;
    var self = this;
    var loadingModels = false;
    return db.createReadStream()
    .on('data', function(data) {
       if (data.value.type === 'tradle.Model') {
         models[data.key] = data;
         self.setPropertyNames(data.value.properties);
       }
       else {
         if (!myId  &&  data.key === MY_IDENTITIES_MODEL + '_1') {
           myId = data.value.currentIdentity;
           if (list[myId])
             me = list[myId].value;
         }
         if (!me  &&  myId  && data.key == myId)
           me = data.value;
         if (data.value[TYPE] === IDENTITY) {
          if (data.value.securityCode) 
            employees[data.value.securityCode] = data.value          
         }
         list[data.key] = data;
       }
     })
    .on('close', function() {
      if (me  &&  me.organization) {
        if (me.securityCode) {
          var org = list[utils.getId(me.organization)].value
          var secCodes = self.searchNotMessages({modelName: 'tradle.SecurityCode', to: org})
          if (!org.securityCodes  ||  org.securityCodes[!me.securityCode]) {
            self.trigger({err: 'The code was not registered with ' + me.organization.title})
            return;
          }
        }
        var photos = list[utils.getId(me.organization.id)].value.photos;
        if (photos)
          me.organization.photo = photos[0].url;
      }
      console.log('Stream closed');
      utils.setModels(models);
    })
    .on('end', function() {
      console.log('Stream ended');
      // if (me)
      //   utils.setMe(me);
      var noModels = self.isEmpty(models);
      if (noModels)
        return self.loadModels();
      // if (noModels || Object.keys(list).length == 2)
      //   if (me)
      //     return self.loadDB();
      //   else {
      //     isLoaded = false;
      //     if (noModels)
      //       return self.loadModels();
      //   }
      // // else
      // //   return self.loadAddressBook();
    })
    .on('error', function(err) {
      console.log('err: ' + err);
    });


  },

  isEmpty(obj) {
    for(var prop in obj) {
      if(obj.hasOwnProperty(prop))
        return false;
    }
    return true;
  },

  getModel(modelName) {
    return models[modelName];
  },
  loadDB(loadTest) {
    loadTest = true;
    // var lt = !Device.isIphone();
    var batch = [];

    if (loadTest) {
      voc.getModels().forEach(function(m) {
        if (!m[ROOT_HASH])
          m[ROOT_HASH] = sha(m);
        batch.push({type: 'put', key: m.id, value: m});
      });
      sampleData.getResources().forEach(function(r) {
        if (!r[ROOT_HASH])
          r[ROOT_HASH] = sha(r);
        r[CUR_HASH] = r[ROOT_HASH];
        var key = r[TYPE] + '_' + r[ROOT_HASH];
        // if (r[TYPE] === IDENTITY_MODEL)
        //   batch.push({type: 'put', key: key, value: r, prefix: identityDb});
        // else
          batch.push({type: 'put', key: key, value: r});

      });
      var self = this;
      return db.batch(batch)
            .then(self.loadMyResources)
            // .then(self.loadAddressBook)
            .catch(function(err) {
              err = err;
              });
    }
    // else {
    //   return this.loadAddressBook()
    //         .catch(function(err) {
    //           err = err;
    //           });
    // }
  },
  loadModels() {
    var batch = [];

    voc.getModels().forEach(function(m) {
      if (!m[ROOT_HASH])
        m[ROOT_HASH] = sha(m);
      batch.push({type: 'put', key: m.id, value: m});
    });
    var self = this;
    return db.batch(batch)
          .then(function() {
            return self.loadMyResources();
          })
          .catch(function(err) {
            err = err;
          });
  },
  // loadModels() {
  //   models = {}
  //   voc.getModels().forEach(function(m) {
  //     models[m.id] = {key: m.id, value: m}
  //   })
  // },
////////////// Not used right now
  onReloadDB1() {
    var self = this;
    isLoaded = false;
    // this.clearDb()
    // .then(function() {
    //   list = {};
    //   return self.loadDB();
    // })
    // .then(function() {
    //   self.trigger({action: 'reloadDB', list: list});
    // })
    this.clearDb()
    .then(function() {
      list = {};
      models = {};
      me = null;
      return self.loadModels();
    })
    .then(function() {
      self.trigger({action: 'reloadDB', models: models});
    })
    .catch(function(err) {
      err = err;
    });
  },
  clearDb() {
    var self = this;
    return db.createReadStream()
    .on('data', function(data) {
       db.del(data.key, function(err) {
         err = err;
       })
    })
    .on('error', function (err) {
      console.log('Oh my!', err.name + ': ' + err.message)
    })
    .on('close', function (err) {
      console.log('Stream closed');
    })
    .on('end', function () {
      console.log('Stream end');
    })
  },

  onChangeIdentity(newMe) {
    var myIdentities = list[MY_IDENTITIES_MODEL + '_1'].value;
    myIdentities.currentIdentity = newMe[TYPE] + '_' + newMe[ROOT_HASH];
      var self = this;
    db.put(MY_IDENTITIES_MODEL + '_1', myIdentities)
    .then(function() {
      return self.loadMyResources()
    })
    .then(function() {
      me = newMe;
      if (me.organization) {
        var photos = list[utils.getId(me.organization.id)].value.photos;
        if (photos)
          me.organization.photo = photos[0].url;
      }
      list = {};
      return self.loadMyResources()
            .then(function() {
              var result = self.searchResources('', IDENTITY_MODEL, me);
              self.trigger({action: 'changeIdentity', list: result, me: me});
            });
    })
    .catch(function(err) {
      err = err;
    });
  },

  onAddNewIdentity(resource) {
    var newIdentity = {
      id: resource[TYPE] + '_' + resource[ROOT_HASH],
      title: utils.getDisplayName(resource, this.getModel(resource[TYPE]).value.properties),
    };
    var myIdentities = list[MY_IDENTITIES_MODEL + '_1'].value;
    myIdentities.allIdentities.push(newIdentity);
    var self = this;
    db.put(MY_IDENTITIES_MODEL + '_1', myIdentities)
    .then(function() {
      list[MY_IDENTITIES_MODEL + '_1'].value = myIdentities;
      self.trigger({action: 'addNewIdentity', resource: me});
    })
    .catch (function(err) {
      err = err;
    })
  },
  onRemoveIdentity(resource) {
    var myIdentity = list[MY_IDENTITIES_MODEL + '_1'].value;
    var iKey = resource[TYPE] + '_' + resource[ROOT_HASH];
    var allIdentities = myIdentity.allIdentities;
    for (var i=0; i<allIdentities.length; i++)
      if (allIdentities[i].id === iKey) {
        allIdentities.splice(i, 1);
        break;
      }

    var batch = [];
    resource.canceled = true;
    batch.push({type: 'put', key: iKey, value: resource});
    batch.push({type: 'put', key: MY_IDENTITIES_MODEL + '_1', value: myIdentity});

    var self = this;
    db.batch(batch)
    .then(function() {
      delete list[resource[TYPE] + '_' + resource[ROOT_HASH]];
      self.trigger({action: 'removeIdentity', resource: resource});
    })
    .catch (function(err) {
      err = err;
    })

  },

});
module.exports = Store;

/*
  put(args) {
    var data = JSON.parse(args.data)

    var attachments
    if (args.attachment) {
      attachments = Array.isArray(args.attachment) ? args.attachment : [args.attachment]
      attachments = attachments.map(function (a) {
        a = a.split('=')
        return {
          name: a[0],
          path: path.resolve(a[1])
        }
      })

      attachments.every(function (a) {
        if (!fs.existsSync(a.path)) {
          throw new Error('attachment not found: ' + a.path)
        }
      })
    }

    var Client = require('./')
    var client = new Client('http://' + args.host + ':' + args.port)

    var builder = new Builder().data(args.data)
    if (attachments) {
      attachments.forEach(builder.attach, builder)
    }

    builder.build(function (err, build) {
      if (err) throw err

      var buf = build.form
      utils.getInfoHash(buf, function (err, infoHash) {
        if (err) throw err

        console.log(infoHash)
        if (args.printOnly) return

        return client.put(infoHash, buf)
          .then(function (resp) {
            if (resp) console.log(resp)
          })
          .done()
      })
    })
  },

*/
