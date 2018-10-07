const TelegramBot = require('node-telegram-bot-api')
const io = require('socket.io')
const micro = require('micro')
const { router, get } = require('microrouter');
const _ = require('lodash')
const database = require('./db')

const CHATS = 'telegram-chats'
const SELFI_LOG = 'selfi-log'
const online = {}

const token = process.env.TOKEN || 'fake'
const telegramBot = new TelegramBot(token, { polling: true });
const server = micro(rest())
const socket = io(server)
initSocket(socket)
server.listen(4000, () => console.log('Listening on localhost:4000'))

telegramBot.onText(/\/selfi/, onGetSelfi)
telegramBot.onText(/\/setCam (.+)/, onPickCamera)
telegramBot.onText(/\/campot/, onInfo)
telegramBot.on('callback_query', onSelectCamera)

function rest() {
  return router(
    get('/ping', async (req, res) => micro.send(res, 200, 'pong'))
  )
}

async function onInfo(msg) {
  console.log('onInfo')
  const chatId = msg.chat.id
  telegramBot.sendMessage(chatId, 'This is webcam bot\n avaliable commands:\n /setCam <token> - connect web camera to chat \n /selfi - take a photo', {
    parse_mode: 'Markdown'
  })
}

async function onPickCamera(msg, match) {
  console.log('onPickCamera', match)
  const chatId = msg.chat.id
  const cameraToken = match[1]
  try {
    telegramBot.sendMessage(chatId, 'Select camera', {
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({
        inline_keyboard: [Object.keys(online).map(cam => ({
          text: cam, callback_data: JSON.stringify({ cam, cameraToken }),
        }))],
      })
    })
  } catch (e) {
    console.log('error: ', e)
    telegramBot.sendMessage(chatId, 'error :(')
  }
}

async function onSelectCamera(query) {
  try {
    const user = query.from.username
    const msgId = query.message.message_id
    const chatId = query.message.chat.id
    const { cam, cameraToken } = JSON.parse(query.data)
    const realCameraToken = _.get(online[cam], 'cameraToken')
    console.log('cb: ', cam, cameraToken, realCameraToken)
    if (realCameraToken === cameraToken) {
      await addCameraToChat({ chatId, cam, cameraToken, user })
      telegramBot.editMessageText(`Camera ${cam} is selected 😎`, { chat_id: chatId, message_id: msgId, reply_markup: '' })
    } else {
      telegramBot.editMessageText(`Oops, camera token does not mutch, try onother one 😕`, { chat_id: chatId, message_id: msgId, reply_markup: '' })
    }
  } catch (e) {
    console.log('error: ', e)
    telegramBot.sendMessage(chatId, 'internal error 😡')
  }
}

function initSocket(socket) {
  socket.use((socket, next) => {
    console.log('io socket handshake: ', socket.handshake.query)
    if (socket.handshake.query && socket.handshake.query.token && socket.handshake.query.cam) {
      socket.cam = socket.handshake.query.cam
      socket.cameraToken = socket.handshake.query.token
      next()
    } else {
      next(new Error('Authentication error'))
    }
  })
  socket.on('connection', onConnection)
}

function onConnection(socket) {
  console.log('onConnection socket: ', socket.cam)
  const cam = socket.cam
  if (!cam) {
    socket.disconnect()
    return 'invalid token'
  }
  online[cam] = socket
  // todo: notify chat, camera connected

  socket.on('disconnect', () => {
    console.info('user disconnected:', cam)
    online[cam] = null
    // todo: notify chat, camera was disconnected
  })

  socket.on('event', (data) => {
    const { chatId, buffer } = data || {}
    if (chatId && buffer && buffer.length > 0) {
      console.log('message:event  chatId: ', chatId)
      const extract = buffer.split(',')[1]
      const buff = new Buffer(extract, 'base64')
      telegramBot.sendPhoto(chatId, buff)
    } else {
      console.log('invalid param: ', data)
    }
  })
}

async function onGetSelfi(msg) {
  const chatId = msg.chat.id
  const user = msg.from.username
  console.log('getting selfi for: ', chatId)
  try {
    const chat = await getChatCamera({ chatId })
    if (chat && chat.cam) {
      const socket = online[chat.cam]
      if (socket && socket.cameraToken === chat.cameraToken) {
        console.log('send event: ', chat.cam, ' for: ', chatId)
        addSelfiLog({ chatId, user, timestamp: Date.now(), status: true })
        socket && socket.emit('event', { chatId, text: 'selfi' })
      } else {
        telegramBot.sendMessage(chatId, 'Camera is offline, or camera token was changed 😕')
      }
    } else {
      telegramBot.sendMessage(chatId, 'This chat does not connect to any camera 😕')
    }
  } catch (e) {
    console.error('cannot send message, ', e)
    telegramBot.sendMessage(chatId, 'Cam bot internal error 😡')
    addSelfiLog({ chatId, user, timestamp: Date.now(), status: false })
  }
}

async function addCameraToChat({ chatId, cam, cameraToken, user }) {
  const db = await database.db()
  const record = { chatId, cam, cameraToken, user }
  return db.collection(CHATS).updateOne({ chatId }, { $set: record }, { upsert: true })
}

async function getChatCamera({ chatId }) {
  const db = await database.db()
  const record = await db.collection(CHATS).findOne({ chatId })
  if (record && record.cam) {
    return record
  } else {
    return Promise.reject('Camera is not connected')
  }
}

async function addSelfiLog({ chatId, user, timestamp, status }) {
  const db = await database.db()
  const record = { chatId, user, timestamp, status }
  return db.collection(SELFI_LOG).updateOne({ chatId }, { $set: record }, { upsert: true })
}