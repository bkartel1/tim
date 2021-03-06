console.log('requiring ContextChooser.js')
'use strict';

import utils from '../utils/utils'
var translate = utils.translate
import constants from '@tradle/constants'
import MessageList from './MessageList'
import PageView from './PageView'
import platformStyles from '../styles/platform'
import reactMixin from 'react-mixin'
import Store from '../Store/Store'
import Actions from '../Actions/Actions'
import Reflux from 'reflux'
import MessageTypeRow from './MessageTypeRow'
import StyleSheet from '../StyleSheet'

import ActivityIndicator from './ActivityIndicator'
const PRODUCT_REQUEST = 'tradle.ProductRequest'
const CONTEXT = 'tradle.Context'

const { TYPE } = constants
import {
  ListView,
  Text,
  // StyleSheet,
  View,
  Platform
} from 'react-native'

import React, { Component } from 'react'

class ContextChooser extends Component {
  constructor(props) {
    super(props);

    var dataSource =  new ListView.DataSource({
      rowHasChanged: (row1, row2) => row1 !== row2,
    });
    this.state = {
      dataSource: dataSource,
      isLoading: true
    };
  }
  componentWillMount() {
    let r = this.props.resource
    let id = r[constants.TYPE] === constants.TYPES.PROFILE ? utils.getId(utils.getMe().organization) : utils.getId(r)
    Actions.getAllContexts({to: this.props.resource})
  }
  componentDidMount() {
    this.listenTo(Store, 'onContexts');
  }
  onContexts(params) {
    if (params.action !== 'allContexts'  ||
        !params.list                     ||
        !params.list.length              ||
        params.to[constants.ROOT_HASH] !== this.props.resource[constants.ROOT_HASH])
      return
    this.setState({
      dataSource: this.state.dataSource.cloneWithRows(params.list),
      isLoading: false
    });
  }

  renderRow(resource)  {
    var model = utils.getModel(resource[constants.TYPE] || resource.id)

    return (
      <MessageTypeRow
        onSelect={() => this.props.selectContext(resource)}
        resource={resource}
        bankStyle={this.props.bankStyle}
        navigator={this.props.navigator}
        to={this.props.resource} />
      );
  }
  renderHeader() {
    return (
      <MessageTypeRow
        onSelect={() => this.props.selectContext()}
        resource={{[TYPE]: PRODUCT_REQUEST, requestFor: 'All'}}
        bankStyle={this.props.bankStyle}
        navigator={this.props.navigator}
        to={this.props.resource} />
    )
    // return (
    //         <View style={{backgroundColor: '#CDE4F7'}}>
    //           <TouchableHighlight underlayColor='transparent' onPress={this.showBanks.bind(this)}>
    //             <View style={styles.row}>
    //               <View>
    //                 <Image source={require('../img/banking.png')} style={styles.cellImage} />
    //               </View>
    //               <View style={styles.textContainer}>
    //                 <Text style={styles.resourceTitle}>Official Accounts</Text>
    //               </View>
    //             </View>
    //           </TouchableHighlight>
    //         </View>
    //       )
  }
  render() {
    if (this.state.isLoading)
      return <PageView >
                <View style={[platformStyles.container, bgStyle]}>
                  <Text style={styles.loading}>{'Loading...'}</Text>
                  <ActivityIndicator size='large' style={{alignSelf: 'center', marginTop: 20}} />
                </View>
              </PageView>

    var content =
      <ListView ref='listview' style={styles.listview}
        dataSource={this.state.dataSource}
        removeClippedSubviews={false}
        initialListSize={100}
        pageSize={10}
        renderRow={this.renderRow.bind(this)}
        enableEmptySections={true}
        automaticallyAdjustContentInsets={false}
        renderHeader={this.renderHeader.bind(this)}
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false} />;

    var bgStyle = this.props.bankStyle  &&  this.props.bankStyle.backgroundColor ? {backgroundColor: this.props.bankStyle.backgroundColor} : {backgroundColor: '#ffffff'}
      // <View style={[styles.container, bgStyle]}>
    return (
      <PageView style={[styles.container, bgStyle]}>
        {content}
      </PageView>
    );
  }
}
reactMixin(ContextChooser.prototype, Reflux.ListenerMixin);

var styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: 'white',
  },
  listview: {
    marginTop: 64,
    borderWidth: 0,
    marginHorizontal: -1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffffff',
  },
  loading: {
    fontSize: 17,
    alignSelf: 'center',
    marginTop: 80,
    color: '#629BCA'
  }
});

module.exports = ContextChooser
