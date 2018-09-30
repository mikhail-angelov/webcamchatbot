const TelegramBot = require('node-telegram-bot-api')
const io = require('socket.io')
const micro = require('micro')

const online = []
const token = process.env.TOKEN || 'fake'
const telegramBot = new TelegramBot(token, { polling: true });
const server = micro()
const socket = io(server)
initSocket(socket)
server.listen(4000, () => console.log('Listening on localhost:4000'))

telegramBot.onText(/\/selfi/, onGetSelfi)
telegramBot.onText(/\/setCam/, onPickCamera)
telegramBot.on('callback_query', onSelectCamera)

function onGetSelfi(msg) {
  console.log('getting selfi for: ', msg.chat.id)
  sendMessage({ chatId: msg.chat.id, text: 'selfi' })
}

async function onPickCamera(msg) {
  console.log('yo')
  const chatId = msg.chat.id
  const fromId = msg.from.id;
  try {
    telegramBot.sendMessage(fromId, 'Select camera', {
      parse_mode: 'Markdown',
      reply_markup: JSON.stringify({
        inline_keyboard: [Object.keys(online).map(cam => ({
          text: cam, callback_data: cam
        }))],
      })
    })
  } catch (e) {
    console.log('error: ', e)
    telegramBot.sendMessage(chatId, 'error :(')
  }
}

function onSelectCamera(query) {
  try {
    const queryId = query.id
    const fromId = query.from.id
    const fromName = query.from.first_name
    const msgId = query.message.message_id
    const chatId = query.message.chat.id
    const cam = query.data
    console.log('cb: ', query)
    Object.keys(online).forEach(item => {
      if (item === cam) {
        online[cam].decoded.chatId = chatId
      }
    })
    telegramBot.editMessageText('Camera is selected', { chat_id: chatId, message_id: msgId, reply_markup: '' })
  } catch (e) {
    console.log('error: ', e)
    telegramBot.sendMessage(chatId, 'error :(')
  }
}

function initSocket(socket) {
  socket.use((socket, next) => {
    console.log('io socket handshake: ', socket.handshake.query)
    if (socket.handshake.query && socket.handshake.query.token) {
      socket.decoded = socket.handshake.query;
      next();
    } else {
      next(new Error('Authentication error'));
    }
  })
  socket.on('connection', onConnection)
}

function onConnection(socket) {
  console.log('onConnection socket: ', socket.decoded)
  const decoded = socket.decoded
  if (!decoded) {
    socket.disconnect()
    return 'invalid token'
  }
  online[decoded.cam] = socket

  socket.on('disconnect', () => {
    console.info('user disconnected:', decoded)
    online[decoded.cam] = null
  })

  socket.on('event', (data) => {
    const { chatId, buffer } = data || {}
    if (chatId && buffer && buffer.listen > 0) {
      console.log('message:event  chatId: ', chatId)
      const extract = buffer.split(',')[1]
      const buff = new Buffer(extract, 'base64')
      telegramBot.sendPhoto(chatId, buff)
    } else {
      console.log('invalid param: ', data)
    }
  })
}

function sendMessage({ chatId, text }) {
  console.log('data', chatId, text)
  try {
    message = { chatId, text }
    Object.keys(online).forEach(cam => {
      const socket = online[cam]
      if (socket && socket.decoded && socket.decoded.chatId === chatId) {
        console.log('send event: ', socket.decoded)
        socket.emit('event', message)
      }
    })
  } catch (e) {
    console.error('cannot send message, ', e)
  }
}
