'use strict';

var NoResources = require('./NoResources');
var ResourceRow = require('./ResourceRow');
var SponsorRow = require('./SponsorRow')
var ResourceView = require('./ResourceView');
var ResourceList = require('./ResourceList');
var VerificationRow = require('./VerificationRow');
var NewResource = require('./NewResource');
var MessageList = require('./MessageList');
var MessageView = require('./MessageView')
var PageView = require('./PageView')
var SupervisoryView = require('./SupervisoryView')
import ActionSheet from 'react-native-actionsheet'
var utils = require('../utils/utils');
var translate = utils.translate
var reactMixin = require('react-mixin');
var extend = require('extend')
var Store = require('../Store/Store');
var Actions = require('../Actions/Actions');
var Reflux = require('reflux');
var constants = require('@tradle/constants');
var Icon = require('react-native-vector-icons/Ionicons');
var QRCodeScanner = require('./QRCodeScanner')
var QRCode = require('./QRCode')
var buttonStyles = require('../styles/buttonStyles');
var NetworkInfoProvider = require('./NetworkInfoProvider')
var defaultBankStyle = require('../styles/bankStyle.json')
var StyleSheet = require('../StyleSheet')

const WEB_TO_MOBILE = '0'
const TALK_TO_EMPLOYEEE = '1'
const APP_QR_CODE = '5'
const PRODUCT_APPLICATION = 'tradle.ProductApplication'
const PARTIAL = 'tradle.Partial'
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const PROFILE = constants.TYPES.PROFILE
const ORGANIZATION = constants.TYPES.ORGANIZATION

// var bankStyles = require('../styles/bankStyles')
const ENUM = 'tradle.Enum'

import React, { Component, PropTypes } from 'react'
import {
  ListView,
  Navigator,
  Alert,
  TouchableOpacity,
  Image,
  StatusBar,
  View,
  Text,
  Platform
} from 'react-native';

import platformStyles from '../styles/platform'
import ENV from '../utils/env'

class HomePage extends Component {
  props: {
    navigator: PropTypes.object.isRequired,
    modelName: PropTypes.string.isRequired,
    resource: PropTypes.object,
    returnRoute: PropTypes.object,
    callback: PropTypes.func,
    filter: PropTypes.string,
    sortProperty: PropTypes.string,
    prop: PropTypes.object,
    isAggregation: PropTypes.bool,
    isRegistration: PropTypes.bool,
  };
  constructor(props) {
    super(props);

    this.state = {
      // isLoading: utils.getModels() ? false : true,
      isLoading: true,
      dataSource: new ListView.DataSource({
        rowHasChanged: function(row1, row2) {
          return row1 !== row2 || row1._online !== row2._online
        }
      }),
      filter: this.props.filter,
      hideMode: false,  // hide provider
      serverOffline: this.props.serverOffline,
      isConnected: this.props.navigator.isConnected,
      userInput: '',
    };
  }
  componentWillUnmount() {
    if (this.props.navigator.getCurrentRoutes().length === 1)
      StatusBar.setHidden(true)
  }
  componentWillMount() {
    var params = {
      modelName: this.props.modelName,
      sponsorName: this.props.sponsorName
    };
    Actions.list(params)
  }
  componentDidMount() {
    this.listenTo(Store, 'onSponsorsList');
  }
  onSponsorsList(params) {
    var action = params.action;
    if (action === 'sponsorsList') {
      let sponsor = params.list  &&  params.list.length && params.list[0]
      this.setState({
        sponsor: sponsor,
        dataSource: this.state.dataSource.cloneWithRows([sponsor]),
        isLoading: false
      })
    }
  }
  mergeStyle(newStyle) {
    let style = {}
    extend(style, defaultBankStyle)
    return newStyle ? extend(style, newStyle) : style
  }

  selectResource(resource) {
    var me = utils.getMe();
    // Case when resource is a model. In this case the form for creating a new resource of this type will be displayed
    var model = utils.getModel(this.props.modelName);
    var isIdentity = this.props.modelName === PROFILE;
    var isVerification = model.value.id === constants.TYPES.VERIFICATION
    var isForm = model.value.id === constants.TYPES.FORM
    var isOrganization = this.props.modelName === ORGANIZATION;
    var m = utils.getModel(resource[TYPE]).value;
    if (!isIdentity         &&
        !isOrganization     &&
        !this.props.callback) {
      if (isVerification || isForm) {
        let title
        if (isForm)
          title = utils.makeModelTitle(m)
        else {
          let type = utils.getType(resource)
          title = utils.makeModelTitle(utils.getModel(type).value)
        }
        this.props.navigator.push({
          title: title,
          id: 5,
          component: MessageView,
          backButtonTitle: 'Back',
          passProps: {
            resource: resource,
            bankStyle: this.props.bankStyle || defaultBankStyle
          }
        });
      }
      else {
        var title = utils.makeTitle(utils.getDisplayName(resource, m.properties))
        this.props.navigator.push({
          title: title,
          id: 3,
          component: ResourceView,
          // titleTextColor: '#7AAAC3',
          backButtonTitle: 'Back',
          rightButtonTitle: 'Edit',
          onRightButtonPress: {
            title: title,
            id: 4,
            component: NewResource,
            titleTextColor: '#7AAAC3',
            backButtonTitle: 'Back',
            rightButtonTitle: 'Done',
            passProps: {
              model: m,
              resource: resource,
              bankStyle: this.props.bankStyle || defaultBankStyle
            }
          },

          passProps: {resource: resource}
        });
      }
      return;
    }
    var title = isIdentity ? resource.firstName : resource.name; //utils.getDisplayName(resource, model.value.properties);
    var modelName = constants.TYPES.MESSAGE;
    var self = this;
    let style = this.mergeStyle(resource.style)
    var route = {
      component: MessageList,
      id: 11,
      backButtonTitle: 'Back',
      passProps: {
        resource: resource,
        filter: '',
        modelName: modelName,
        currency: resource.currency,
        bankStyle: style,
      },
    }
    if (isIdentity) { //  ||  isOrganization) {
      route.title = resource.firstName
      var isMe = isIdentity ? resource[ROOT_HASH] === me[ROOT_HASH] : true;
      if (isMe) {
        route.onRightButtonPress.rightButtonTitle = 'Edit'
        route.onRightButtonPress.onRightButtonPress = {
          title: title,
          id: 4,
          component: NewResource,
          titleTextColor: '#7AAAC3',
          backButtonTitle: 'Back',
          rightButtonTitle: 'Done',
          passProps: {
            bankStyle: style,
            model: utils.getModel(resource[TYPE]).value,
            resource: resource,
            currency: this.props.currency,
          }
        }
      }
    }
    if (this.props.officialAccounts) {
      if (isOrganization)
        route.title = resource.name
      var msg = {
        message: translate('customerWaiting', me.firstName),
        _t: constants.TYPES.CUSTOMER_WAITING,
        from: me,
        to: utils.isEmployee(resource) ? me.organization : resource,
        time: new Date().getTime()
      }

      utils.onNextTransitionEnd(this.props.navigator, () => Actions.addMessage({msg: msg, isWelcome: true}))
    }

    this.props.navigator.push(route);
  }

  _selectResource(resource) {
    var model = utils.getModel(this.props.modelName);
    var title = utils.getDisplayName(resource, model.value.properties);
    var newTitle = title;
    if (title.length > 20) {
      var t = title.split(' ');
      newTitle = '';
      t.forEach(function(word) {
        if (newTitle.length + word.length > 20)
          return;
        newTitle += newTitle.length ? ' ' + word : word;
      })
    }

    var route = {
      title: utils.makeTitle(newTitle),
      id: 3,
      component: ResourceView,
      parentMeta: model,
      backButtonTitle: 'Back',
      passProps: {
        resource: resource,
        bankStyle: this.props.style,
        currency: this.props.currency
      },
    }
    // Edit resource
    var me = utils.getMe();
    if ((me || this.state.isRegistration) &&  this.props.prop) {
      this.props.callback(this.props.prop, resource); // HACK for now
      if (this.props.returnRoute)
        this.props.navigator.popToRoute(this.props.returnRoute);
      else
        this.props.navigator.pop()
      return;
    }
    if (me                       &&
       !model.value.isInterface  &&
       (resource[ROOT_HASH] === me[ROOT_HASH]  ||  resource[TYPE] !== PROFILE)) {
      var self = this ;
      route.rightButtonTitle = 'Edit'
      route.onRightButtonPress = /*() =>*/ {
        title: 'Edit',
        id: 4,
        component: NewResource,
        rightButtonTitle: 'Done',
        titleTextColor: '#7AAAC3',
        passProps: {
          model: utils.getModel(resource[TYPE]).value,
          bankStyle: this.props.style,
          resource: me
        }
      };
    }
    this.props.navigator.push(route);
  }

  renderRow(resource)  {
    var model = utils.getModel(this.props.modelName).value;
    if (model.isInterface)
      model = utils.getModel(resource[TYPE]).value
 // || (model.id === constants.TYPES.FORM)
    var isVerification = model.id === constants.TYPES.VERIFICATION  ||  model.subClassOf === constants.TYPES.VERIFICATION
    var isForm = model.id === constants.TYPES.FORM || model.subClassOf === constants.TYPES.FORM
    var isMyProduct = model.id === 'tradle.MyProduct'  ||  model.subClassOf === 'tradle.MyProduct'
    var isSharedContext = model.id === PRODUCT_APPLICATION && utils.isReadOnlyChat(resource)

    // let hasBacklink = this.props.prop && this.props.prop.items  &&  this.props.prop.backlink
    return (
      <SponsorRow
        onSelect={() => this.selectResource(resource)}
        key={resource[ROOT_HASH]}
        navigator={this.props.navigator}
        currency={this.props.currency}
        isOfficialAccounts={this.props.officialAccounts}
        resource={resource}/>
    );
  }
  renderFooter() {
    var me = utils.getMe();
    // if (!me  ||  (this.props.prop  &&  (this.props.prop.readOnly || (this.props.prop.items  &&  this.props.prop.items.readOnly))))
    //   return <View />;
    var model = utils.getModel(this.props.modelName).value;
    if (!this.props.prop  &&  model.id !== ORGANIZATION)
      return <View />
    // if (model.subClassOf === constants.TYPES.FINANCIAL_PRODUCT ||  model.subClassOf === ENUM)
    //   return <View />
    if (this.props.prop  &&  !this.props.prop.allowToAdd)
      return <View />
    let icon = Platform.OS === 'ios' ?  'md-more' : 'md-menu'
    let color = Platform.OS === 'ios' ? '#ffffff' : 'red'
    return (
        <View style={styles.footer}>
          <TouchableOpacity onPress={() => this.ActionSheet.show()}>
            <View style={platformStyles.menuButtonNarrow}>
              <Icon name={icon}  size={33}  color={color} />
            </View>
          </TouchableOpacity>
        </View>
     )
  }
  showBanks() {
    this.props.navigator.push({
      title: translate('officialAccounts'),
      id: 10,
      component: ResourceList,
      backButtonTitle: 'Back',
      titleTextColor: '#7AAAC3',
      passProps: {
        officialAccounts: true,
        serverOffline: this.state.serverOffline,
        bankStyle: this.props.style,
        modelName: ORGANIZATION
      }
    });
  }

  render() {
    var content;
    var model = utils.getModel(this.props.modelName).value;
    if (this.state.dataSource.getRowCount() === 0   &&
        utils.getMe()                               &&
        !utils.getMe().organization                 &&
        model.subClassOf !== ENUM                   &&
        !this.props.isChooser                       &&
        this.props.modelName !== ORGANIZATION  &&
        (!model.subClassOf  ||  model.subClassOf !== ENUM)) {
      content = <NoResources
                  filter={this.state.filter}
                  model={model}
                  isLoading={this.state.isLoading}/>
    }
    else {
      content = <ListView
          dataSource={this.state.dataSource}
          renderHeader={this.renderHeader.bind(this)}
          enableEmptySections={true}
          renderRow={this.renderRow.bind(this)}
          automaticallyAdjustContentInsets={false}
          removeClippedSubviews={false}
          keyboardDismissMode='on-drag'
          keyboardShouldPersistTaps={true}
          initialListSize={10}
          pageSize={20}
          scrollRenderAhead={10}
          showsVerticalScrollIndicator={false} />;
    }
    var actionSheet = null //this.renderActionSheet()
    var footer = actionSheet && this.renderFooter()
    let network = this.props.isChooser || !this.props.officialAccounts || this.props.modelName !== ORGANIZATION
                ? <View/>
                : <NetworkInfoProvider connected={this.state.isConnected} serverOffline={this.state.serverOffline} />

    // let title = this.props.tabLabel
    //           ? <View style={{height: 45, backgroundColor: '#ffffff', alignSelf: 'stretch', justifyContent: 'center'}}>
    //               <Text style={{alignSelf: 'center', fontSize: 20}}>{translate('officialAccounts')}</Text>
    //             </View>
    //           : null
      // <PageView style={[platformStyles.container, this.props.tabLabel ? {marginTop: utils.isAndroid() ? 10 : 18} : {}]}>
      //   {title}

    return (
      <PageView style={platformStyles.container}>
        {network}
        <View style={styles.separator} />
        {content}
        {footer}
        {actionSheet}
      </PageView>
    );
  }

  renderHeader() {
    let digital = (
              <View style={{padding: 5, backgroundColor: '#ffffff', marginBottom: 2}}>
                <TouchableOpacity onPress={this.showProfile.bind(this)}>
                  <View style={styles.row}>
                    <Icon name='ios-globe' color='goldenrod' size={45} style={styles.cellImage} />
                    <View style={[styles.textContainer, {flexDirection: 'row', flex:1}]}>
                      <Text style={[styles.resourceTitle, {flex: 1}]}>{translate('digitalWealthPassport')}</Text>
                      <Icon color='#AAAAAA' size={20} name={'ios-arrow-forward'} style={{marginTop: 5}}/>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
             )
    let officialAccounts = (
              <View style={{padding: 5, backgroundColor: '#ffffff', marginBottom: 2}}>
                <TouchableOpacity onPress={this.showBanks.bind(this)}>
                  <View style={styles.row}>
                    <Image source={require('../img/banking.png')} style={styles.cellImage} />
                    <View style={[styles.textContainer, {flexDirection: 'row', flex:1}]}>
                      <Text style={[styles.resourceTitle, {flex: 1}]}>{translate('officialAccounts')}</Text>
                      <Icon color='#AAAAAA' size={20} name={'ios-arrow-forward'} style={{marginTop: 5}}/>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
             )
    return  <View>
              {digital}
              {officialAccounts}
            </View>
  }
  showProfile() {
    this.props.navigator.push({
      title: translate('digitalWealthPassport'),
      id: 3,
      component: ResourceView,
      titleTextColor: '#7AAAC3',
      backButtonTitle: 'Back',
      passProps: {
        resource: utils.getMe()
      }
   })
  }
}
reactMixin(HomePage.prototype, Reflux.ListenerMixin);

var styles = StyleSheet.create({
  centerText: {
    alignItems: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: '#eeeeee',
  },
  icon: {
    marginLeft: -23,
    marginTop: -25,
    color: 'red'
  },
  image: {
    width: 25,
    height: 25,
    marginRight: 5,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    height: 45,
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
    // borderColor: '#eeeeee',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#cccccc',
  },
  row: {
    flexDirection: 'row',
    padding: 5,
  },
  textContainer: {
    alignSelf: 'center',
  },
  resourceTitle: {
    fontSize: 20,
    fontWeight: '400',
    color: '#757575',
    marginBottom: 2,
    paddingLeft: 5
  },
  cellImage: {
    height: 45,
    marginRight: 10,
    width: 45,
  },
  menuButton: {
    marginTop: -23,
    paddingVertical: 5,
    paddingHorizontal: 21,
    borderRadius: 24,
    shadowOpacity: 1,
    shadowRadius: 5,
    shadowColor: '#afafaf',
    backgroundColor: 'red'
  },
  sharedContext: {
    position: 'absolute',
    right: 5,
    top: 20,
    width: 20,
    height:20,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#246624'
  },
  sharedContextText: {
    fontSize: 14,
    alignSelf: 'center',
    color: '#ffffff'
  },
});

module.exports = HomePage
