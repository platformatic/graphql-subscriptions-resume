import { StatefulSubscriptions } from '../src/index.ts'
import assert from 'assert'
import { test } from 'node:test'
import { type Logger } from 'pino'

// Create a default mock logger to use in tests
const createMockLogger = () => {
  // Create a mock logger function that also has all the expected methods
  const logger = Object.assign(
    () => { }, // Base function
    {
      error: () => { },
      info: () => { },
      debug: () => { },
      warn: () => { },
      fatal: () => { },
      trace: () => { },
      child: () => logger,
      level: 'info'
    }
  )
  return logger as unknown as Logger
}

// Tests for subscription options args feature

test('should store args in subscription configuration', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          filter: 'important',
          limit: 10
        }
      }
    ],
    logger: createMockLogger()
  })
  
  // Check that args were stored in configuration
  const config = (state as any).subscriptionsConfig.get('onItems')
  assert.deepEqual(config.args, { filter: 'important', limit: 10 }, 'Args should be stored in config')
})

test('should pass args from config to subscription object', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          filter: 'important',
          limit: 10
        }
      }
    ],
    logger: createMockLogger()
  })
  
  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  
  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  
  // Check that args were passed to subscription object
  assert.deepEqual(subscription?.options.args, { filter: 'important', limit: 10 }, 'Args should be passed to subscription object')
})

test('should include fixed args in recovery query', () => {
  const query = 'subscription { onItems { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          filter: 'important',
          limit: 10
        }
      }
    ],
    logger: createMockLogger()
  })
  
  state.addSubscription('clientId', query)
  
  // Update the subscription state with a value
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

  // Create a mock WebSocket to capture what gets sent
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  // Assert that the recovery subscription includes the fixed args
  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload
  const recoveryQuery = payload?.query

  // Verify the query contains both the key and the fixed args
  assert.ok(recoveryQuery?.includes('offset: 42'), 'Recovery query should include the key field with value')
  assert.ok(recoveryQuery?.includes('filter: "important"'), 'Recovery query should include the fixed filter arg')
  assert.ok(recoveryQuery?.includes('limit: 10'), 'Recovery query should include the fixed limit arg')
})

test('should support different fixed args for different subscriptions', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          category: 'products',
          active: true
        }
      },
      {
        name: 'onUsers',
        key: 'id',
        args: {
          status: 'online',
          role: 'admin'
        }
      }
    ],
    logger: createMockLogger()
  })
  
  // Add subscriptions
  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name, email } }')
  
  // Update states
  state.updateSubscriptionState('clientId', {
    onItems: { id: 'item1', offset: 100, data: 'items data' }
  })
  
  state.updateSubscriptionState('clientId', {
    onUsers: { id: 'user1', name: 'User One', email: 'user@example.com' }
  })
  
  // Create a mock WebSocket
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }
  
  // Restore subscriptions
  state.restoreSubscriptions('clientId', mockSocket)
  
  // Should have 3 messages: connection_init and two recovery subscriptions
  assert.equal(mockSocket.messages.length, 3)
  
  // Get the queries
  const queries = mockSocket.messages.slice(1).map(msg => msg.payload?.query)
  
  // Check that each subscription has the correct fixed args
  const itemsQuery = queries.find(q => q && q.includes('onItems'))
  const usersQuery = queries.find(q => q && q.includes('onUsers'))
  
  assert.ok(itemsQuery?.includes('offset: 100'), 'Items query should include the offset key')
  assert.ok(itemsQuery?.includes('category: "products"'), 'Items query should include the category arg')
  assert.ok(itemsQuery?.includes('active: true'), 'Items query should include the active arg')
  
  assert.ok(usersQuery?.includes('id: "user1"'), 'Users query should include the id key')
  assert.ok(usersQuery?.includes('status: "online"'), 'Users query should include the status arg')
  assert.ok(usersQuery?.includes('role: "admin"'), 'Users query should include the role arg')
})

test('should work with mixed data types in fixed args', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          stringArg: 'string value',
          numberArg: 42,
          booleanArg: true,
          nullArg: null,
          objectArg: { nested: 'value' },
          arrayArg: [1, 2, 3]
        }
      }
    ],
    logger: createMockLogger()
  })
  
  state.addSubscription('clientId', 'subscription { onItems { id, offset } }')
  
  // Update with a value to enable recovery
  state.updateSubscriptionState('clientId', {
    onItems: { id: 'test', offset: 50 }
  })
  
  // Capture recovery query
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }
  
  state.restoreSubscriptions('clientId', mockSocket)
  
  // Get the query
  const dataTypesQuery = mockSocket.messages[1].payload?.query
  
  // Verify all data types are properly serialized
  assert.ok(dataTypesQuery?.includes('stringArg: "string value"'), 'Should properly serialize string args')
  assert.ok(dataTypesQuery?.includes('numberArg: 42'), 'Should properly serialize number args')
  assert.ok(dataTypesQuery?.includes('booleanArg: true'), 'Should properly serialize boolean args')
  assert.ok(dataTypesQuery?.includes('nullArg: null'), 'Should properly serialize null args')
  assert.ok(dataTypesQuery?.includes('objectArg: {"nested":"value"}'), 'Should properly serialize object args')
  assert.ok(dataTypesQuery?.includes('arrayArg: [1,2,3]'), 'Should properly serialize array args')
})

// Test for fixed args with subscription aliases
test('should include fixed args in recovery query with aliases', () => {
  const query = 'subscription { CustomItems: onItems { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          filter: 'important',
          limit: 10
        }
      }
    ],
    logger: createMockLogger()
  })
  
  state.addSubscription('clientId', query)
  
  // Update the subscription state with a value
  state.updateSubscriptionState('clientId', {
    CustomItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

  // Create a mock WebSocket to capture what gets sent
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  // Assert that the recovery subscription includes the fixed args
  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload
  const recoveryQuery = payload?.query

  // Verify the query contains both the key, alias, and fixed args
  assert.ok(recoveryQuery?.includes('CustomItems: onItems'), 'Recovery query should include the alias')
  assert.ok(recoveryQuery?.includes('offset: 42'), 'Recovery query should include the key field with value')
  assert.ok(recoveryQuery?.includes('filter: "important"'), 'Recovery query should include the fixed filter arg')
  assert.ok(recoveryQuery?.includes('limit: 10'), 'Recovery query should include the fixed limit arg')
})

// Original tests below

test('should parse the incoming subscription and detect the fields', () => {
  const query = 'subscription { onItems { id, offset } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.fields, ['id', 'offset'])
})

test('should parse the incoming subscription and detect the fields in a query with a fragment', () => {
  const query = 'subscription { onItems { ...onItemFields } } fragment onItemFields on Item { id, offset }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.fields, ['id', 'offset'])
})

test('should parse the incoming subscription and detect the fields in a query params', () => {
  const query = 'subscription { onItems(offset: 1) { id, offset } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.fields, ['id', 'offset'])
  assert.deepEqual(subscription?.params, { offset: 1 })
})

test('should parse the incoming subscription and detect the fields in a query params with a fragment', () => {
  const query = 'subscription { onItems(offset: 1) { ...onItemFields } } fragment onItemFields on Item { id, offset }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.fields, ['id', 'offset'])
  assert.deepEqual(subscription?.params, { offset: 1 })
})

test('should inject missing key field instead of throwing an error', () => {
  const query = 'subscription { onItems { id } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // This should not throw an error anymore
  state.addSubscription('clientId', query)

  // Verify the subscription was added with the injected key
  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  assert.ok(subscription, 'Subscription should be created')
  assert.ok(subscription?.injectedKey, 'Subscription should be flagged as having injected key')
  assert.ok(subscription?.fields.includes('offset'), 'Fields should include the injected key')
})

test('should skip non subscription queries', () => {
  const query = 'query { getItems { id } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // This should not throw an error and return gracefully
  state.addSubscription('clientId', query)

  // Verify no subscription was added
  const client = state.clients.get('clientId')
  assert.equal(client?.subscriptions.size, 0)
})

test('should parse response and update client subscription state by key fields', () => {
  const query = 'subscription { onItems { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id',
      offset: 99,
      data: '...'
    }
  })

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.lastValue, 99)
})

test('should send recovery subscription with the last received key', () => {
  // Setup a StatefulSubscriptions instance with configuration
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // Add a subscription for a client
  const query = 'subscription { onItems { id, offset, data } }'
  state.addSubscription('clientId', query)

  // Update the subscription state with some data (simulating receiving a subscription event)
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

  // Create a mock WebSocket to capture what gets sent
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions with the mock WebSocket
  state.restoreSubscriptions('clientId', mockSocket)

  // Assert that the connection was initialized
  assert.equal(mockSocket.messages[0].type, 'connection_init')

  // Assert that the recovery subscription was sent with the correct parameters
  const startMessage = mockSocket.messages[1]
  assert.equal(startMessage.type, 'start')
  assert.equal(startMessage.id, 'clientId')

  // Verify the query includes the recovery subscription name and the last value
  const payload = startMessage.payload
  assert.equal(payload?.query, 'subscription { onItems(offset: 42) { id, offset, data } }')
})

test('should get last value from params if any', () => {
  const query = 'subscription { onItems(offset: 42) { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.equal(subscription?.lastValue, 42)
})

test('should remove all subscriptions for a client', () => {
  // Setup a StatefulSubscriptions instance with configuration
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // Add a subscription for a client
  const query = 'subscription { onItems { id, offset, data } }'
  state.addSubscription('clientId', query)

  // Verify the subscription was added
  const clientBefore = state.clients.get('clientId')
  assert.equal(clientBefore?.subscriptions.size, 1)
  assert.ok(clientBefore?.subscriptions.has('onItems'))

  // Call removeAllSubscriptions
  state.removeAllSubscriptions('clientId')

  // Verify the subscriptions were removed
  const clientAfter = state.clients.get('clientId')
  assert.equal(clientAfter?.subscriptions.size, 0)
})

test('should handle removing subscriptions for non-existent client', () => {
  // Setup a StatefulSubscriptions instance
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  // Call removeAllSubscriptions for a client that doesn't exist
  // This should not throw an error
  state.removeAllSubscriptions('nonExistentClient')

  // Verify the client map doesn't contain the client
  assert.equal(state.clients.has('nonExistentClient'), false)
})

test('should remove all subscriptions for a client with multiple subscriptions', () => {
  // Setup a StatefulSubscriptions instance with multiple subscription configurations
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      },
      {
        name: 'onUsers',
        key: 'id'
      }
    ],
    logger: createMockLogger()
  })

  // Add multiple subscriptions for a client
  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name, email } }')

  // Verify the subscriptions were added
  const clientBefore = state.clients.get('clientId')
  assert.equal(clientBefore?.subscriptions.size, 2)
  assert.ok(clientBefore?.subscriptions.has('onItems'))
  assert.ok(clientBefore?.subscriptions.has('onUsers'))

  // Call removeAllSubscriptions
  state.removeAllSubscriptions('clientId')

  // Verify the subscriptions were removed
  const clientAfter = state.clients.get('clientId')
  assert.equal(clientAfter?.subscriptions.size, 0)
})

test('should extract lastValue from variables', () => {
  const query = 'subscription { onItems { id, offset, data } }'
  const variables = { lastValue: 50 }
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query, variables)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.equal(subscription?.lastValue, 50)
})

test('should handle query with variable references', () => {
  const query = 'subscription($offsetVar: Int!) { onItems(offset: $offsetVar) { id, offset, data } }'
  const variables = { offsetVar: 75 }
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query, variables)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.params, { offset: 75 })
})

test('should combine variable references and lastValue', () => {
  const query = 'subscription($offsetVar: Int!) { onItems(offset: $offsetVar) { id, offset, data } }'
  const variables = { offsetVar: 100, lastValue: 120 }
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query, variables)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.equal(subscription?.lastValue, 120) // lastValue from variables takes precedence
  assert.deepEqual(subscription?.params, { offset: 100 }) // offset from variable reference
})

// New tests to improve coverage

test('should initialize with empty subscriptions', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  assert.equal(state.subscriptionsConfig.size, 0)
  assert.equal(state.clients.size, 0)
})

test('should handle nested fields in subscriptions', () => {
  const query = 'subscription { onItems { id, offset, nested { field1, field2 } } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  // Nested fields should be extracted properly
  assert.deepEqual(subscription?.fields, ['id', 'offset', 'field1', 'field2'])
})

test('should handle inline fragments in subscriptions', () => {
  const query = 'subscription { onItems { id, offset, ... on Item { extraField } } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  assert.deepEqual(subscription?.fields, ['id', 'offset', 'extraField'])
})

test('should skip duplicate subscription additions', () => {
  const query = 'subscription { onItems { id, offset } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // Add the subscription once
  state.addSubscription('clientId', query)

  // Add the same subscription again
  state.addSubscription('clientId', query)

  // Check that we only have one subscription
  const client = state.clients.get('clientId')
  assert.equal(client?.subscriptions.size, 1)
})

test('should skip unconfigured subscription', () => {
  const query = 'subscription { onUnconfigured { id, someField } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // This should not throw an error
  const result = state.addSubscription('clientId', query)
  assert.equal(result, undefined)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onUnconfigured')

  assert.equal(subscription, undefined)
})

test('should handle updateSubscriptionState with different value types', () => {
  const query = 'subscription { onItems { id, offset, boolField, nullField } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query)

  // Update with different value types
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 0,
      boolField: true,
      nullField: null
    }
  })

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  assert.strictEqual(subscription?.lastValue, 0)
})

test('should handle updateSubscriptionState with missing key field', () => {
  const query = 'subscription { onItems { id, offset } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query)

  // Update without the key field
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123'
      // offset is missing
    }
  })

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  // lastValue should still be null since the key field was missing
  assert.strictEqual(subscription?.lastValue, null)
})

test('should handle updateSubscriptionState for non-existent client', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  // This should not throw an error
  state.updateSubscriptionState('nonExistentClient', {
    onItems: {
      id: 'id123',
      offset: 42
    }
  })
})

test('should handle updateSubscriptionState for non-existent subscription', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  // Add a client
  state.addSubscription('clientId', 'subscription { onItems { id } }')

  // This should not throw an error
  state.updateSubscriptionState('clientId', {
    onNonexistent: {
      id: 'id123',
      offset: 42
    }
  })
})

test('should handle multiple updates to the same subscription', () => {
  const query = 'subscription { onItems { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('clientId', query)

  // First update
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id1',
      offset: 10,
      data: 'data1'
    }
  })

  let client = state.clients.get('clientId')
  let subscription = client?.subscriptions.get('onItems')
  assert.strictEqual(subscription?.lastValue, 10)

  // Second update
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id2',
      offset: 20,
      data: 'data2'
    }
  })

  client = state.clients.get('clientId')
  subscription = client?.subscriptions.get('onItems')
  assert.strictEqual(subscription?.lastValue, 20)
})

test('should restore only subscriptions without lastValue', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      },
      {
        name: 'onUsers',
        key: 'id'
      }
    ],
    logger: createMockLogger()
  })

  // Add two subscriptions
  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name } }')

  // Update only one subscription with a lastValue
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

  // Create a mock WebSocket
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  console.log(mockSocket.messages)
  assert.equal(mockSocket.messages.length, 3)
  assert.equal(mockSocket.messages[0].type, 'connection_init')
  assert.equal(mockSocket.messages[1].type, 'start')
  assert.equal(mockSocket.messages[2].type, 'start')

  assert.ok(mockSocket.messages[1].payload?.query.includes('onItems'))
  assert.ok(mockSocket.messages[2].payload?.query.includes('onUsers'))
})

test('should restore multiple subscriptions with lastValues', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      },
      {
        name: 'onUsers',
        key: 'id'
      }
    ],
    logger: createMockLogger()
  })

  // Add two subscriptions
  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name } }')

  // Update both with lastValues
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

  state.updateSubscriptionState('clientId', {
    onUsers: {
      id: 'user456',
      name: 'John Doe'
    }
  })

  // Create a mock WebSocket
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  // Should have 3 messages: connection_init and two recovery subscriptions
  assert.equal(mockSocket.messages.length, 3)
  assert.equal(mockSocket.messages[0].type, 'connection_init')
  assert.equal(mockSocket.messages[1].type, 'start')
  assert.equal(mockSocket.messages[2].type, 'start')

  // Check that both recovery subscriptions were sent
  const queries = mockSocket.messages.slice(1).map(msg => msg.payload?.query)
  assert.ok(queries.some(q => q === 'subscription { onItems(offset: 42) { id, offset, data } }'))
  assert.ok(queries.some(q => q === 'subscription { onUsers(id: "user456") { id, name } }'))
})

test('should support subscription aliases', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // Add a subscription with an alias
  const query = 'subscription { Items: onItems { id, offset, field1, field2 } }'
  state.addSubscription('clientId', query)

  // Check that the subscription was stored with the alias as the key
  const client = state.clients.get('clientId')
  assert.ok(client?.subscriptions.has('Items'))

  // Verify the subscription object has the correct properties
  const subscription = client?.subscriptions.get('Items')
  assert.equal(subscription?.name, 'onItems')
  assert.equal(subscription?.alias, 'Items')
  assert.deepEqual(subscription?.fields, ['id', 'offset', 'field1', 'field2'])

  // Update the subscription state with a result that uses the alias
  state.updateSubscriptionState('clientId', {
    Items: {
      id: 'trade123',
      offset: 100,
      field1: 'value1',
      field2: 'value2'
    }
  })

  // Verify the lastValue was updated
  assert.equal(subscription?.lastValue, 100)

  // Test recovery query generation with the alias
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  // Check that the recovery query includes the alias
  const startMessage = mockSocket.messages[1]
  assert.equal(startMessage.type, 'start')

  // Verify the query includes the alias
  const payload = startMessage.payload
  assert.equal(payload?.query, 'subscription { Items: onItems(offset: 100) { id, offset, field1, field2 } }')
})

test('should handle non-existent client in restoreSubscriptions', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  const mockSocket = {
    messages: [] as Array<any>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // This should not throw an error
  state.restoreSubscriptions('nonExistentClient', mockSocket)

  // No messages should be sent
  assert.equal(mockSocket.messages.length, 0)
})

test('should handle error thrown from extractSubscriptionQueryInfo', () => {
  // Create a more complete mock logger that matches the behavior of a real logger
  let loggedError: any = null
  let loggedMsg: string | null = null

  const mockLogger = {
    error: (obj: { err: any }, msg: string) => {
      loggedError = obj.err
      loggedMsg = msg
    },
    // Add other required methods with no-op implementations
    info: () => { },
    debug: () => { },
    warn: () => { },
    fatal: () => { },
    trace: () => { },
    child: () => mockLogger,
    level: 'info'
  } as unknown as Logger

  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: mockLogger
  })

  // Use an obviously invalid GraphQL query to guarantee a parsing error
  const invalidQuery = 'subscription { this is completely invalid GraphQL! }'

  // This should not throw an error to the caller
  const result = state.addSubscription('clientId', invalidQuery)
  assert.equal(result, undefined)

  // Verify the error was logged correctly
  assert.notEqual(loggedError, null, 'Expected an error to be logged')
  assert.equal(loggedMsg, 'Error parsing GraphQL query', 'Expected specific error message')

  // Verify client state was created but no subscription was added
  const client = state.clients.get('clientId')
  assert.ok(client, 'Client state should be created')
  assert.equal(client.subscriptions.size, 0, 'No subscription should have been added')
})

// Add new test for updateSubscriptionState specifically for aliases
test('should update subscription state by key fields when using aliases in response', () => {
  const query = 'subscription { CustomItems: onItems { id, offset, data } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  // Update using the alias in the result object
  state.updateSubscriptionState('clientId', {
    CustomItems: {
      id: 'id-aliased',
      offset: 200,
      data: 'aliased data'
    }
  })

  const client = state.clients.get('clientId')
  // The subscription should be stored with the alias as key
  const subscription = client?.subscriptions.get('CustomItems')
  assert.deepEqual(subscription?.lastValue, 200)

  // Make sure the original name is correctly preserved
  assert.equal(subscription?.name, 'onItems')
  assert.equal(subscription?.alias, 'CustomItems')
})

// Test for multiple aliases to the same subscription
test('should handle multiple aliases to the same subscription', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  // Add two subscriptions to the same endpoint but with different aliases
  state.addSubscription('clientId', 'subscription { FirstItems: onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { SecondItems: onItems { id, offset, data } }')

  // Verify both subscriptions were added under their respective aliases
  const client = state.clients.get('clientId')
  assert.equal(client?.subscriptions.size, 2)
  assert.ok(client?.subscriptions.has('FirstItems'))
  assert.ok(client?.subscriptions.has('SecondItems'))

  // Update each subscription state separately
  state.updateSubscriptionState('clientId', {
    FirstItems: {
      id: 'id1',
      offset: 10,
      data: 'data1'
    }
  })

  state.updateSubscriptionState('clientId', {
    SecondItems: {
      id: 'id2',
      offset: 20,
      data: 'data2'
    }
  })

  // Verify each subscription has its own state
  const firstSub = client?.subscriptions.get('FirstItems')
  const secondSub = client?.subscriptions.get('SecondItems')

  assert.equal(firstSub?.lastValue, 10)
  assert.equal(secondSub?.lastValue, 20)

  // Ensure they both refer to the same original subscription name
  assert.equal(firstSub?.name, 'onItems')
  assert.equal(secondSub?.name, 'onItems')
})

test('should inject missing key field in subscription', () => {
  const query = 'subscription { onItems { id, data } }' // Note: offset is missing
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  // Verify key was injected
  assert.ok(subscription?.injectedKey, 'Subscription should be flagged as having injected key')
  assert.ok(subscription?.fields.includes('offset'), 'Key field should have been injected')
  assert.deepEqual(subscription?.fields, ['id', 'data', 'offset'], 'Fields should include injected key')
})

test('should remove injected key field from results', () => {
  const query = 'subscription { onItems { id, data } }' // Note: offset is missing
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  // Create a result object that we'll pass to updateSubscriptionState
  const result = {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  // Update the subscription state
  state.updateSubscriptionState('clientId', result)

  // Verify the key field was removed from the result
  assert.ok(!('offset' in result.onItems), 'Key field should be removed from result')
  assert.deepEqual(result.onItems, { id: 'item123', data: 'some data' }, 'Result should not contain the key field')

  // Verify the subscription has the lastValue set correctly
  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.equal(subscription?.lastValue, 42, 'lastValue should be set from the key field')
})

test('should not remove key field if it was not injected', () => {
  const query = 'subscription { onItems { id, data, offset } }' // Note: offset is included
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  // Create a result object that we'll pass to updateSubscriptionState
  const result = {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  // Make a copy for comparison
  const originalResult = JSON.parse(JSON.stringify(result))

  // Update the subscription state
  state.updateSubscriptionState('clientId', result)

  // Verify the key field was NOT removed from the result
  assert.ok('offset' in result.onItems, 'Key field should not be removed from result')
  assert.deepEqual(result.onItems, originalResult.onItems, 'Result should be unchanged')
})

test('should work with aliases when injecting key field', () => {
  const query = 'subscription { Items: onItems { id, data } }' // Note: offset is missing and alias is used
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('Items')

  // Verify key was injected
  assert.ok(subscription?.injectedKey, 'Subscription should be flagged as having injected key')
  assert.ok(subscription?.fields.includes('offset'), 'Key field should have been injected')

  // Create a result object that uses the alias
  const result = {
    Items: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  // Update the subscription state
  state.updateSubscriptionState('clientId', result)

  // Verify the key field was removed from the result
  assert.ok(!('offset' in result.Items), 'Key field should be removed from aliased result')
  assert.deepEqual(result.Items, { id: 'item123', data: 'some data' }, 'Result should not contain the key field')

  // Verify the subscription has the lastValue set correctly
  assert.equal(subscription?.lastValue, 42, 'lastValue should be set from the key field')
})

test('should include injected field in recovery query', () => {
  const query = 'subscription { onItems { id, data } }' // Note: offset is missing
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })
  state.addSubscription('clientId', query)

  // Update the subscription state with a value
  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

  // Create a mock WebSocket to capture what gets sent
  const mockSocket = {
    messages: [] as Array<{
      type: string;
      id?: string;
      payload?: {
        query: string;
      };
    }>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }

  // Call restoreSubscriptions
  state.restoreSubscriptions('clientId', mockSocket)

  // Assert that the recovery subscription includes the injected field
  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload

  // The recovery query should include all fields including the injected field
  assert.ok(payload?.query.includes('id'), 'Recovery query should include original fields')
  assert.ok(payload?.query.includes('data'), 'Recovery query should include original fields')
  assert.ok(payload?.query.includes('offset'), 'Recovery query should include injected key field')
})
