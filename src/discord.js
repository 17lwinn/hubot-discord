/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Description:
//   Adapter for Hubot to communicate on Discord
//
// Commands:
//   None
//
// Configuration:
//   HUBOT_DISCORD_TOKEN          - authentication token for bot
//   HUBOT_DISCORD_STATUS_MSG     - Status message to set for "currently playing game"
//
// Notes:
//
let Adapter, _EnterMessage, LeaveMessage, Robot, TextMessage, _TopicMessage, User
try {
  ({ Robot, Adapter, _EnterMessage, LeaveMessage, _TopicMessage, TextMessage, User } = require('hubot'))
} catch (error) {
  const prequire = require('parent-require');
  ({ Robot, Adapter, _EnterMessage, LeaveMessage, _TopicMessage, TextMessage, User } = prequire('hubot'))
}

const Discord = require('discord.js')
// const { TextChannel } = Discord
const ReactionMessage = require('./reaction_message')

// Settings
const currentlyPlaying = process.env.HUBOT_DISCORD_STATUS_MSG || ''

Robot.prototype.react = function (matcher, options, callback) {
  // this function taken from the hubot-slack api
  let matchReaction = msg => msg instanceof ReactionMessage

  if (arguments.length === 1) {
    return this.listen(matchReaction, matcher)
  } else if (matcher instanceof Function) {
    matchReaction = msg => msg instanceof ReactionMessage && matcher(msg)
  } else {
    callback = options
    options = matcher
  }

  return this.listen(matchReaction, options, callback)
}

class DiscordBot extends Adapter {
  constructor (robot) {
    {
      // Hack: trick Babel/TypeScript into allowing this before super.
      if (false) { super() }
      let thisFn = (() => { return this }).toString()
      let thisName = thisFn.match(/return (?:_assertThisInitialized\()*(\w+)\)*;/)[1]
      eval(`${thisName} = this;`)
    }
    this._has_permission = this._has_permission.bind(this)
    this.ready = this.ready.bind(this)
    this.message = this.message.bind(this)
    this.message_reaction = this.message_reaction.bind(this)
    this.disconnected = this.disconnected.bind(this)
    super(...arguments)
    this.rooms = {}
    if ((process.env.HUBOT_DISCORD_TOKEN == null)) {
      this.robot.logger.error('Error: Environment variable named `HUBOT_DISCORD_TOKEN` required')
    }
  }

  run () {
    this.options =
            { token: process.env.HUBOT_DISCORD_TOKEN }

    this.client = new Discord.Client({ autoReconnect: true, fetch_all_members: true, api_request_method: 'burst', ws: { compress: true, large_threshold: 1000 } })
    this.robot.client = this.client
    this.client.on('ready', this.ready)
    this.client.on('message', this.message)
    this.client.on('disconnected', this.disconnected)
    this.client.on('error', error => {
      return this.robot.logger.error(`The client encountered an error: ${error}`)
    })
    this.client.on('messageReactionAdd', (message, user) => {
      return this.message_reaction('reaction_added', message, user)
    })
    this.client.on('messageReactionRemove', (message, user) => {
      return this.message_reaction('reaction_removed', message, user)
    })

    return this.client.login(this.options.token).catch(this.robot.logger.error)
  }

  _map_user (discord_user, channel_id) {
    const user = this.robot.brain.userForId(discord_user.id)
    user.room = channel_id
    user.name = discord_user.username
    user.discriminator = discord_user.discriminator
    user.id = discord_user.id

    return user
  }

  _format_incoming_message (message) {
    if (this.rooms[message.channel.id] == null) { this.rooms[message.channel.id] = message.channel }
    let text = message.cleanContent != null ? message.cleanContent : message.content
    if ((message != null ? message.channel : undefined) instanceof Discord.DMChannel) {
      if (!text.match(new RegExp(`^@?${this.robot.name}`))) { text = `${this.robot.name}: ${text}` }
    }

    return text
  }

  _has_permission (channel, user) {
    const isText = (channel !== null) && (channel.type === 'text')
    const permissions = isText && channel.permissionsFor(user)
    if (isText) { return ((permissions !== null) && permissions.hasPermission('SEND_MESSAGES')) } else { return channel.type !== 'text' }
  }

  ready () {
    this.robot.logger.info(`Logged in: ${this.client.user.username}#${this.client.user.discriminator}`)
    this.robot.name = this.client.user.username
    this.robot.logger.info(`Robot Name: ${this.robot.name}`)
    this.emit('connected')

    // post-connect actions
    for (let channel of Array.from(this.client.channels)) { this.rooms[channel.id] = channel }
    return this.client.user.setActivity(currentlyPlaying)
      .then(this.robot.logger.debug(`Status set to ${currentlyPlaying}`))
      .catch(this.robot.logger.error)
  }

  message (message) {
    // ignore messages from myself
    if (message.author.id === this.client.user.id) { return }

    const user = this._map_user(message.author, message.channel.id)
    const text = this._format_incoming_message(message)

    this.robot.logger.debug(text)
    return this.receive(new TextMessage(user, text, message.id))
  }

  message_reaction (reaction_type, message, user) {
    // ignore reactions from myself
    if (user.id === this.client.user.id) { return }

    const reactor = this._map_user(user, message.message.channel.id)
    const author = this._map_user(message.message.author, message.message.channel.id)
    const text = this._format_incoming_message(message.message)

    const text_message = new TextMessage(reactor, text, message.message.id)
    let reaction = message._emoji.name
    if (message._emoji.id != null) {
      reaction += `:${message._emoji.id}`
    }
    return this.receive(new ReactionMessage(reaction_type, reactor, reaction, author,
      text_message, message.createdTimestamp)
    )
  }

  disconnected () {
    return this.robot.logger.info(`${this.robot.name} Disconnected, will auto reconnect soon...`)
  }

  send (envelope, ...messages) {
    return Array.from(messages).map((message) =>
      this.sendMessage(envelope.room, message))
  }

  reply (envelope, ...messages) {
    return Array.from(messages).map((message) =>
      this.sendMessage(envelope.room, `<@${envelope.user.id}> ${message}`))
  }

  sendMessage (channelId, message) {
    const errorHandle = err => robot.logger.error(`Error sending: ${message}\r\n${err}`)

    // Padded blank space before messages to comply with https://github.com/meew0/discord-bot-best-practices
    const zSWC = '\u200B'
    message = zSWC + message

    var { robot } = this
    const { _has_permission } = this
    const sendChannelMessage = function (channel, message) {
      if (_has_permission(channel, __guard__(robot != null ? robot.client : undefined, x => x.user))) {
        return channel.sendMessage(message, { split: true })
          .then(msg => robot.logger.debug(`SUCCESS! Message sent to: ${channel.id}`)).catch(function (err) {
            robot.logger.debug(`Error sending: ${message}\r\n${err}`)
            if (process.env.HUBOT_OWNER) {
              const owner = robot.client.users.get(process.env.HUBOT_OWNER)
              return owner.send(`Couldn't send message to ${channel.name} (${channel}) in ${channel.guild.name}, contact ${channel.guild.owner}.\r\n${error}`)
                .then(msg => robot.logger.debug(`SUCCESS! Message sent to: ${owner.id}`)).catch(err => robot.logger.debug(`Error sending: ${message}\r\n${err}`))
            }
          })
      } else {
        robot.logger.debug(`Can't send message to ${channel.name}, permission denied`)
        if (process.env.HUBOT_OWNER) {
          const owner = robot.client.users.get(process.env.HUBOT_OWNER)
          return owner.send(`Couldn't send message to ${channel.name} (${channel}) in ${channel.guild.name}, contact ${channel.guild.owner} to check permissions`)
            .then(msg => robot.logger.debug(`SUCCESS! Message sent to: ${owner.id}`)).catch(err => robot.logger.debug(`Error sending: ${message}\r\n${err}`))
        }
      }
    }

    const sendUserMessage = (user, message) =>
      user.send(message, { split: true })
        .then(msg => robot.logger.debug(`SUCCESS! Message sent to: ${user.id}`)).catch(err => robot.logger.debug(`Error sending: ${message}\r\n${err}`))

    // @robot.logger.debug "#{@robot.name}: Try to send message: \"#{message}\" to channel: #{channelId}"

    if (this.rooms[channelId] != null) { // room is already known and cached
      return sendChannelMessage(this.rooms[channelId], message)
    } else { // unknown room, try to find it
      const channels = this.client.channels.filter(channel => channel.id === channelId)
      if (channels.first() != null) {
        return sendChannelMessage(channels.first(), message)
      } else if (this.client.users.get(channelId) != null) {
        return sendUserMessage(this.client.users.get(channelId), message)
      } else {
        return this.robot.logger.debug(`Unknown channel id: ${channelId}`)
      }
    }
  }

  channelDelete (channel, client) {
    const roomId = channel.id
    const user = new User(client.user.id)
    user.room = roomId
    user.name = client.user.username
    user.discriminator = client.user.discriminator
    user.id = client.user.id
    this.robot.logger.info(`${user.name}#${user.discriminator} leaving ${roomId} after a channel delete`)
    return this.receive(new LeaveMessage(user, null, null))
  }

  guildDelete (guild, client) {
    const serverId = guild.id
    const roomIds = (Array.from(guild.channels).map((channel) => channel.id))
    return (() => {
      const result = []
      for (let room in rooms) {
        const user = new User(client.user.id)
        user.room = room.id
        user.name = client.user.username
        user.discriminator = client.user.discriminator
        user.id = client.user.id
        this.robot.logger.info(`${user.name}#${user.discriminator} leaving ${roomId} after a guild delete`)
        result.push(this.receive(new LeaveMessage(user, null, null)))
      }
      return result
    })()
  }
}

exports.use = robot => new DiscordBot(robot)

function __guard__ (value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined
}
