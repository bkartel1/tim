console.log('requiring automaticUpdates.js')

import { AsyncStorage, Alert } from 'react-native'
import utils from './utils'
import Actions from '../Actions/Actions'

let CodePush = !__DEV__ && !utils.isSimulator() && require('react-native-code-push')
// if (CodePush) CodePush.notifyAppReady()

let ON = !!CodePush
let CHECKING
// every 10 mins
let DEFAULT_INTERVAL = 10 * 60 * 1000
let downloadedUpdate = false
let currentSync
const CODE_UPDATE_KEY = '~hascodeupdate'
const noop = () => {}

// remove on app start
// in case the user restarted the app manually
AsyncStorage.removeItem(CODE_UPDATE_KEY)

module.exports = {
  sync,
  on,
  off,
  hasUpdate,
  install
}

async function hasUpdate () {
  if (downloadedUpdate) return true

  try {
    const item = await AsyncStorage.getItem(CODE_UPDATE_KEY)
    downloadedUpdate = !!item
  } catch (err)  {
    return false
  }
}

async function install (opts={}) {
  const { warn=true, delay=3000 } = opts
  const item = await AsyncStorage.getItem(CODE_UPDATE_KEY)
  if (!item) return false

  if (warn) {
    Actions.showModal({
      title: utils.translate('installingUpdate') + '...',
      message: utils.translate('restartingApp')
    })
  }

  if (typeof delay === 'number' && delay > 0) {
    await utils.promiseDelay(delay)
  }

  await AsyncStorage.removeItem(CODE_UPDATE_KEY)
  CodePush.restartApp()
  return true
}

function checkPeriodically (millis=DEFAULT_INTERVAL) {
  if (CHECKING) return CHECKING

  return CHECKING = sync()
    .then(() => utils.promiseDelay(millis))
    .then(() => {
      if (!downloadedUpdate) {
        // loop
        return ON && checkPeriodically(millis)
      }
    })
}

function sync (opts={}) {
  if (!(CodePush && ON)) return Promise.resolve(false)
  if (downloadedUpdate) return Promise.resolve(true)
  if (currentSync) return currentSync

  return currentSync = CodePush.sync(
    {
      // use our own dialog below when the download completes
      updateDialog: false,
      installMode: CodePush.InstallMode.ON_NEXT_RESTART
    },
    opts.onSyncStatusChanged,
    opts.onDownloadProgress
  )
  .then(
    syncStatus => {
      if (syncStatus === CodePush.SyncStatus.UPDATE_INSTALLED) {
        return AsyncStorage.setItem(CODE_UPDATE_KEY, '1')
          .then(() => {
            downloadedUpdate = true
            Actions.downloadedCodeUpdate()
          })
      }
    },
    err => false
  )
  .then(result => {
    currentSync = null
    return result
  })
}

function on (period) {
  if (CodePush) {
    ON = true
    checkPeriodically(period)
  }
}

function off () {
  if (CodePush) ON = false
}
