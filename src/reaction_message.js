/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const { Message } = require.main.require('hubot')

class ReactionMessage extends Message {
  // Represents a message generated by an emoji reaction event
  // - this was copied from the hubot-slack api and should function similarly
  //
  // type      - A String indicating 'reaction_added' or 'reaction_removed'
  // user      - A User instance that reacted to the item.
  // reaction  - A String identifying the emoji reaction.
  // item_user - A String indicating the user that posted the item.
  // item      - An Object identifying the target message, file, or comment item.
  // event_ts  - A String of the reaction event timestamp.
  constructor (type, user, reaction, item_user, item, event_ts) {
    {
      // Hack: trick Babel/TypeScript into allowing this before super.
      if (false) { super() }
      let thisFn = (() => { return this }).toString()
      let thisName = thisFn.match(/return (?:_assertThisInitialized\()*(\w+)\)*;/)[1]
      eval(`${thisName} = this;`)
    }
    this.type = type
    this.user = user
    this.reaction = reaction
    this.item_user = item_user
    this.item = item
    this.event_ts = event_ts
    super(this.user)
    this.type = this.type.replace('reaction_', '')
  }
}

module.exports = ReactionMessage