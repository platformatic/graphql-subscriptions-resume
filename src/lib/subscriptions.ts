import { extractSubscriptionQueryInfo, extractSubscriptionResultInfo } from './graphql-tools.ts'

type SubscriptionOptions = {
  name: string
  key: string
  recovery: {
    key: string
    subscription: string
  }
}

type StatefulSubscriptionsOptions = {
  subscriptions: SubscriptionOptions[]
}

type ClientState = {
  subscriptions: Map<string, Subscription>
}

type Subscription = {
  options: SubscriptionOptions
  name: string
  fields: string[]
  params?: Record<string, any>
  lastValue: any
}

/**
 * Builds a recovery query for a subscription
 * @param subscription The subscription to build a recovery query for
 * @returns A GraphQL query string for the recovery subscription
 */
function buildRecoveryQuery (subscription: Subscription): string {
  // Use the recovery subscription name from the subscription options
  const recoverySubscriptionName = subscription.options.recovery.subscription
  // Use the recovery key from the subscription options
  const recoveryKey = subscription.options.recovery.key
  // Use the last value received from the subscription
  const lastValue = subscription.lastValue

  // Build a recovery query with the last value as a parameter
  return `subscription { ${recoverySubscriptionName}(${recoveryKey}: ${JSON.stringify(lastValue)}) { ${subscription.fields.join(', ')} } }`
}

export class StatefulSubscriptions {
  clients: Map<string, ClientState>
  subscriptionsConfig: Map<string, {
    key: string
    recovery: {
      key: string
      subscription: string
    }
  }>

  constructor (options: StatefulSubscriptionsOptions) {
    this.clients = new Map()
    this.subscriptionsConfig = new Map()

    // Store subscription configurations for easy access
    for (const subscription of options.subscriptions) {
      this.subscriptionsConfig.set(subscription.name, {
        key: subscription.key,
        recovery: subscription.recovery
      })
    }
  }

  createClientState () {
    return {
      subscriptions: new Map()
    }
  }

  addSubscription (clientId: string, query: string) {
    let client = this.clients.get(clientId)
    if (!client) {
      client = this.createClientState()
      this.clients.set(clientId, client)
    }

    const s = extractSubscriptionQueryInfo(query)

    // Skip if not a subscription query or if parsing failed
    if (!s) {
      return
    }

    // TODO support different subscriptions with same name, with different fields/fragments/values
    if (client.subscriptions.has(s.name)) {
      return
    }

    // Check if this subscription is configured
    const config = this.subscriptionsConfig.get(s.name)
    if (config) {
      // Validate that the key field is included in the subscription
      if (!s.fields.includes(config.key)) {
        throw new Error(`Subscription ${s.name} is missing required key field: ${config.key}`)
      }
    }

    // Create a new subscription object with the required properties
    const subscription: Subscription = {
      options: {
        name: s.name,
        key: config?.key || '',
        recovery: config?.recovery || { key: '', subscription: '' }
      },
      name: s.name,
      fields: s.fields,
      lastValue: null
    }

    // Add params if they exist
    if (s.params) {
      subscription.params = s.params
    }

    client.subscriptions.set(s.name, subscription)
  }

  updateSubscriptionState (clientId: string, result: any) {
    const client = this.clients.get(clientId)
    if (!client) return

    const r = extractSubscriptionResultInfo(result)

    // If client doesn't have this subscription, skip
    if (!client.subscriptions.has(r.name)) {
      return
    }

    // Get the subscription from the client
    const subscription = client.subscriptions.get(r.name)
    if (!subscription) return

    // Get the subscription configuration
    const config = this.subscriptionsConfig.get(r.name)
    if (!config) return

    // Update the lastValue with the value of the key field from the result
    const keyValue = r.data[config.key]
    if (keyValue !== undefined) {
      subscription.lastValue = keyValue
    }
  }

  // target is a WebSocket
  restoreSubscriptions (clientId: string, target: any) {
    const client = this.clients.get(clientId)
    if (!client) return

    // Initialize connection
    target.send(JSON.stringify({
      type: 'connection_init'
    }))

    // Call the recovery subscription for all subscriptions for this client with the lastValue
    for (const subscription of client.subscriptions.values()) {
      // Only restore subscriptions that have a lastValue
      if (subscription.lastValue !== null) {
        target.send(JSON.stringify({
          id: clientId,
          type: 'start',
          payload: {
            query: buildRecoveryQuery(subscription)
          }
        }))
      }
    }
  }

  removeAllSubscriptions (clientId: string) {
    const client = this.clients.get(clientId)
    if (!client) return

    client.subscriptions.clear()
  }
}
