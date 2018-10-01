const TelegramBot = require('node-telegram-bot-api')
const io = require('socket.io')
const micro = require('micro')

// todo: this is bad design, those vars make this component stateful, so they should be moved to DB
const online = {}
const chats ={}

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
  console.log('onPickCamera')
  const chatId = msg.chat.id
  const fromId = msg.from.id;
  try {
    telegramBot.sendMessage(chatId, 'Select camera', {
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
    chats[chatId] = cam
    telegramBot.editMessageText(`Camera ${cam} is selected`, { chat_id: chatId, message_id: msgId, reply_markup: '' })
  } catch (e) {
    console.log('error: ', e)
    telegramBot.sendMessage(chatId, 'error :(')
  }
}

function initSocket(socket) {
  socket.use((socket, next) => {
    console.log('io socket handshake: ', socket.handshake.query)
    if (socket.handshake.query && socket.handshake.query.token &&
      socket.handshake.query.token === process.env.SECRET) {
      socket.cam = socket.handshake.query.cam
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

function sendMessage({ chatId, text }) {
  console.log('sendMessage: ', chatId, text)
  try {
    const cam = chats[chatId]
    const socket = online[cam]
    console.log('send event: ', !!socket, cam, ' for: ', chatId)
    socket && socket.emit('event', { chatId, text })
  } catch (e) {
    console.error('cannot send message, ', e)
  }
}
