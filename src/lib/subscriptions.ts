import { extractSubscriptionQueryInfo, extractSubscriptionResultInfo, type SubscriptionInfo } from './graphql-tools.ts'
import { type Logger } from 'pino'
// @ts-ignore
import abstractLogger from 'abstract-logging'

type SubscriptionOptions = {
  name: string
  key: string
  args?: Record<string, any>
}

type StatefulSubscriptionsOptions = {
  subscriptions: SubscriptionOptions[]
  logger: Logger
}

type ClientState = {
  init: any // connection_init payload
  subscriptions: Map<string, Subscription>
  ids: Map<string, string> // subscriptionId -> subscription name
}

type Subscription = {
  options: SubscriptionOptions
  name: string
  fields: string[]
  params?: Record<string, any>
  lastValue: any
  alias?: string
  injectedKey?: boolean

  id?: string // websocket subscription id
  type: string // websocket subscription type
}

/**
 * Builds a the subscription query for recovery
 * @param subscription The subscription to build a recovery query for
 * @returns A GraphQL query string for the recovery subscription
 */
function buildRecoveryQuery (subscription: Subscription): string {
  // If there's an alias, include it in the recovery query
  const aliasPrefix = subscription.alias ? `${subscription.alias}: ` : ''

  // Prepare args for the query, starting with the key if any
  const args = subscription.lastValue !== null && subscription.lastValue !== undefined
    ? [`${subscription.options.key}: ${JSON.stringify(subscription.lastValue)}`]
    : []

  // Add any fixed args from options if they exist
  if (subscription.options.args) {
    for (const [key, value] of Object.entries(subscription.options.args)) {
      args.push(`${key}: ${JSON.stringify(value)}`)
    }
  }

  return `subscription { ${aliasPrefix}${subscription.options.name}${args.length > 0 ? `(${args.join(', ')})` : ''} { ${subscription.fields.join(', ')} } }`
}

export class StatefulSubscriptions {
  clients: Map<string, ClientState>
  subscriptionsConfig: Map<string, {
    key: string
    args?: Record<string, any>
  }>

  logger: Logger
  constructor (options: StatefulSubscriptionsOptions) {
    this.clients = new Map()
    this.subscriptionsConfig = new Map()
    this.logger = options.logger ?? abstractLogger

    // Store subscription configurations for easy access
    for (const subscription of options.subscriptions) {
      this.subscriptionsConfig.set(subscription.name, {
        key: subscription.key,
        args: subscription.args
      })
    }
  }

  createClientState () {
    return {
      init: undefined,
      subscriptions: new Map(),
      ids: new Map()
    }
  }

  addSubscriptionInit (clientId: string, payload: any) {
    let client = this.clients.get(clientId)
    if (!client) {
      client = this.createClientState()
      this.clients.set(clientId, client)
    }

    client.init = payload
  }

  addSubscription (clientId: string, query: string, variables?: Record<string, any>, subscriptionId?: string, subscriptionType?: string) {
    let client = this.clients.get(clientId)
    if (!client) {
      client = this.createClientState()
      this.clients.set(clientId, client)
    }

    let s: SubscriptionInfo | undefined
    try {
      s = extractSubscriptionQueryInfo(query, variables)
    } catch (err) {
      this.logger.error({ err }, 'Error parsing GraphQL query')
      return
    }

    // Skip if not a subscription query or if parsing failed
    if (!s) {
      return
    }

    // Determine the subscription identifier - use alias if available, otherwise use name
    const subscriptionName = s.alias || s.name

    if (client.subscriptions.has(subscriptionName)) {
      return
    }

    // Check if this subscription is configured - we use original name for config lookup, not alias
    const config = this.subscriptionsConfig.get(s.name)
    if (!config) {
      // cant find config for this subscription, skip
      return
    }

    // Check if the key field is included in the subscription
    const keyIncluded = s.fields.includes(config.key)
    let injectedKey = false

    // If key is missing, flag the subscription and inject the key field into the fields array
    if (!keyIncluded) {
      injectedKey = true
      s.fields.push(config.key)
      this.logger.debug({ subscription: s.name, key: config.key }, 'Injecting missing key field into subscription')
    }

    // Create a new subscription object with the required properties
    const subscription: Subscription = {
      options: {
        name: s.name,
        key: config.key,
        args: config.args
      },
      name: s.name,
      fields: s.fields,
      lastValue: (variables && 'lastValue' in variables)
        ? variables.lastValue
        : s.params?.[config.key] || null,
      injectedKey,
      type: subscriptionType || 'start'
    }

    // Add params if they exist
    if (s.params) {
      subscription.params = s.params
    }

    // Store alias if present
    if (s.alias) {
      subscription.alias = s.alias
    }

    // Store using the subscription identifier (alias or name)
    if (subscriptionId) {
      subscription.id = subscriptionId
      client.ids.set(subscriptionId, subscriptionName)
    }
    subscription.type = subscriptionType || 'start'
    client.subscriptions.set(subscriptionName, subscription)
  }

  updateSubscriptionState (clientId: string, result: any) {
    this.logger.debug({ clientId, result }, 'Updating subscription state')

    const client = this.clients.get(clientId)
    if (!client) return

    const r = extractSubscriptionResultInfo(result)

    // The resultName from the GraphQL response is the alias or the original name
    const resultName = r.resultName

    // If client doesn't have this subscription under the result name (which could be an alias), skip
    if (!client.subscriptions.has(resultName)) {
      return
    }

    // Get the subscription from the client
    const subscription = client.subscriptions.get(resultName)
    if (!subscription) return

    // Get the subscription configuration using the original name, not the alias
    const config = this.subscriptionsConfig.get(subscription.name)
    if (!config) return

    // Update the lastValue with the value of the key field from the result
    const keyValue = r.data[config.key]
    if (keyValue !== undefined) {
      subscription.lastValue = keyValue
    }

    // If the key was injected, we should remove it from the result data
    // before any further processing of the result by the client
    if (subscription.injectedKey && keyValue !== undefined) {
      // Create a shallow copy of the result data without the injected key
      const dataWithoutKey = { ...r.data }
      delete dataWithoutKey[config.key]

      // Replace the original data with our filtered version
      result[r.resultName] = dataWithoutKey
    }
  }

  // target is a WebSocket
  restoreSubscriptions (clientId: string, target: any) {
    this.logger.debug({ clientId }, 'Restoring subscriptions')

    const client = this.clients.get(clientId)
    if (!client) return

    // Initialize connection
    target.send(JSON.stringify({
      type: 'connection_init',
      payload: client.init
    }))

    // Call the recovery subscription for all subscriptions for this client with the lastValue
    for (const subscription of client.subscriptions.values()) {
      this.logger.debug({ subscription }, 'Restoring subscription')

      target.send(JSON.stringify({
        id: subscription.id,
        type: subscription.type,
        payload: {
          query: buildRecoveryQuery(subscription)
        }
      }))
    }
  }

  removeSubscription (clientId: string, subscriptionId: string) {
    if (!subscriptionId) return

    const client = this.clients.get(clientId)
    if (!client) return

    const subscriptionName = client.ids.get(subscriptionId)
    if (!subscriptionName) return

    client.subscriptions.delete(subscriptionName)
    client.ids.delete(subscriptionId)
  }

  removeAllSubscriptions (clientId: string) {
    const client = this.clients.get(clientId)
    if (!client) return

    client.subscriptions.clear()
    client.ids.clear()
  }
}
