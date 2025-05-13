# @platformatic/graphql-subscriptions-resume

An addon to @fastify/http-proxy to resume GraphQL subscriptions. This library helps manage subscriptions state across client connections, allowing clients to resume subscriptions from where they left off after reconnecting.

## Installation

```bash
npm install @platformatic/graphql-subscriptions-resume
```

or

```bash
pnpm add @platformatic/graphql-subscriptions-resume
```

## Key Features

- **State Persistence**: Track subscription state by client ID
- **Resumable Subscriptions**: Automatically resume subscriptions from the last received value
- **GraphQL Parsing**: Smart parsing of GraphQL subscription queries
- **Alias Support**: Handle subscription aliases properly
- **Easy Integration**: Works well with Platformatic proxy services or any WebSocket-based GraphQL implementation

## Usage

### Basic Setup

```typescript
import { StatefulSubscriptions } from '@platformatic/graphql-subscriptions-resume'
import { logger } from './your-logger.js'

// Initialize with your subscription configurations
const state = new StatefulSubscriptions({
  subscriptions: [
    {
      name: 'onItems',  // The subscription name in your GraphQL schema
      key: 'offset'     // The field that represents a sequence or position (e.g., offset, timestamp, id)
    },
    {
      name: 'onNotifications',
      key: 'id'
    }
  ],
  logger: logger // Provide a Pino-compatible logger
})
```

### Integration with WebSocket Handlers

```typescript
// Handle client connections
function onConnect(clientId) {
  console.log(`Client ${clientId} connected`)
}

// Handle client disconnections
function onDisconnect(clientId) {
  console.log(`Client ${clientId} disconnected`)
  // Clean up subscriptions when a client disconnects
  state.removeAllSubscriptions(clientId)
}

// Handle client reconnections
function onReconnect(clientId, webSocketConnection) {
  console.log(`Client ${clientId} reconnected`)
  // Restore subscriptions to their previous state
  state.restoreSubscriptions(clientId, webSocketConnection)
}

// Process incoming subscription requests
function onIncomingMessage(clientId, message) {
  // Parse the message and handle subscription requests
  const parsedMessage = JSON.parse(message)
  
  if (parsedMessage.type === 'start') {
    try {
      // Register the subscription with the state manager
      state.addSubscription(
        clientId,
        parsedMessage.payload.query,
        parsedMessage.payload.variables
      )
    } catch (err) {
      console.error('Error adding subscription', err)
    }
  }
}

// Process outgoing subscription updates
function onOutgoingMessage(clientId, message) {
  const parsedMessage = JSON.parse(message)
  
  if (parsedMessage.type === 'data') {
    // Update the subscription state with the latest data
    state.updateSubscriptionState(clientId, parsedMessage.payload.data)
  }
}
```

### Complete Example with Platformatic GraphQL Proxy

Here's a complete example using the library with Platformatic's GraphQL proxy:

```javascript
'use strict'

const { StatefulSubscriptions } = require('@platformatic/graphql-subscriptions-resume')

const state = new StatefulSubscriptions({
  subscriptions: [
    {
      name: 'onItems',
      key: 'offset'
    },
    {
      name: 'onNotifications',
      key: 'id',
    }
  ],
  logger: globalThis.platformatic.logger
})

const hooks = {
  onConnect: (context, source, target) => {
    context.log.info({ clientId: source.clientId }, 'onConnect')
  },
  onDisconnect: (context, source, target) => {
    context.log.info({ clientId: source.clientId }, 'onDisconnect (client disconnected)')
    state.removeAllSubscriptions(source.clientId)
  },
  onReconnect: (context, source, target) => {
    context.log.info({ clientId: source.clientId }, 'onReconnect')
    state.restoreSubscriptions(source.clientId, target)
  },
  onIncomingMessage: (context, source, target, message) => {
    const m = JSON.parse(message.data.toString('utf-8'))
    context.log.info({ m, binary: message.binary, clientId: source.clientId }, 'onIncomingMessage')
    source.clientId = m.id

    if (m.type !== 'start') {
      return
    }

    try {
      state.addSubscription(source.clientId, m.payload.query, m.payload.variables)
    } catch (err) {
      context.log.error({ err, m, clientId: source.clientId }, 'Error adding subscription')
    }
  },
  onOutgoingMessage: (context, source, target, message) => {
    const m = JSON.parse(message.data.toString('utf-8'))
    context.log.info({ m, binary: message.binary, clientId: source.clientId }, 'onOutgoingMessage')

    if (m.type !== 'data') {
      return
    }

    state.updateSubscriptionState(source.clientId, m.payload.data)
  }
}

module.exports = hooks
```

## How It Works

The library works by:

1. **Tracking Subscriptions**: When a client initiates a subscription, the library parses the GraphQL query to extract the subscription name, fields, parameters, and aliases.

2. **Monitoring Updates**: As subscription data is sent to clients, the library tracks the value of the configured "key" field for each subscription.

3. **Resuming After Reconnection**: When a client reconnects, the library automatically generates and sends a new subscription query that includes the last received key value, allowing the subscription to resume from where it left off.

## API Reference

### `StatefulSubscriptions`

The main class for managing subscriptions.

#### Constructor

```typescript
new StatefulSubscriptions(options: StatefulSubscriptionsOptions)
```

**Options:**

- `subscriptions`: Array of subscription configurations
  - `name`: The name of the subscription as defined in your GraphQL schema
  - `key`: The field name used to track the subscription's position/state
  - `args`: (Optional) Fixed arguments that will be included in every recovery query
- `logger`: A Pino-compatible logger instance

#### Methods

##### `addSubscription`

```typescript
addSubscription(clientId: string, query: string, variables?: Record<string, any>): void
```

Registers a new subscription for a client. Parses the GraphQL query and stores information about the subscription.

**Parameters:**
- `clientId`: A unique identifier for the client
- `query`: The GraphQL subscription query
- `variables`: Optional GraphQL variables for the query

##### `updateSubscriptionState`

```typescript
updateSubscriptionState(clientId: string, result: any): void
```

Updates the state of a client's subscription based on the latest result.

**Parameters:**
- `clientId`: The client's unique identifier
- `result`: The data object containing the subscription result

##### `restoreSubscriptions`

```typescript
restoreSubscriptions(clientId: string, target: any): void
```

Restores all subscriptions for a client after reconnection.

**Parameters:**
- `clientId`: The client's unique identifier
- `target`: The WebSocket connection to send subscription requests to

##### `removeAllSubscriptions`

```typescript
removeAllSubscriptions(clientId: string): void
```

Removes all subscriptions for a specific client.

**Parameters:**
- `clientId`: The client's unique identifier

## Resume Logic

When a client reconnects, the library creates a recovery query using the last known value of the key field. The key field is automatically injected into the query parameters, even if it wasn't present in the original subscription query. For example, if a client was subscribed to updates with an `offset` of 42 before disconnecting, the recovery query will look like:

```graphql
subscription {
  onItems(offset: 42) {
    id
    offset
    data
  }
}
```

If you've configured fixed arguments via the `args` property, these will be included in the recovery query as well:

```graphql
subscription {
  onItems(offset: 42, filter: "important", limit: 10) {
    id
    offset
    data
  }
}
```

This query tells the GraphQL server to send updates starting from offset 42, ensuring the client doesn't miss any updates that occurred during the disconnection. The library handles this key injection automatically, so you don't need to modify your client-side subscription queries to support resumption.

## Advanced Features

### Subscription Aliases

The library fully supports GraphQL aliases. When a client uses an alias in their subscription:

```graphql
subscription {
  itemsUpdates: onItems {
    id
    offset
    price
  }
}
```

The library will correctly track and restore the subscription using the alias.

### Variable Handling

The library properly handles GraphQL variables in subscription queries:

```graphql
subscription($lastOffset: Int!) {
  onItems(offset: $lastOffset) {
    id
    offset
    price
  }
}
```

With variables:

```json
{
  "lastOffset": 100
}
```
