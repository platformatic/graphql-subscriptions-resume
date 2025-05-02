import { StatefulSubscriptions } from '../src/index.ts'
import { getQueryHash } from '../src/lib/graphql-tools.ts'
import assert from 'assert'
import { test } from 'node:test'

test('should parse the incoming subscription and detect the fields', () => {
  const query = 'subscription { onItems { id, offset } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
  })
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.deepEqual(subscription?.fields, ['id', 'offset'])
  assert.deepEqual(subscription?.params, { offset: 1 })
})

test('should throw an error if the key fields are not found', () => {
  const query = 'subscription { onItems { id } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
  })

  assert.throws(() => {
    state.addSubscription('clientId', query)
  }, /Subscription onItems is missing required key field: offset/)
})

test('should skip non subscription queries', () => {
  const query = 'query { getItems { id } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
  assert.equal(payload?.query, 'subscription { onItemsRecovery(offset: 42) { id, offset, data } }')
})

test('should remove all subscriptions for a client', () => {
  // Setup a StatefulSubscriptions instance with configuration
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
    subscriptions: []
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      },
      {
        name: 'onUsers',
        key: 'id',
        recovery: {
          key: 'id',
          subscription: 'onUsersRecovery'
        }
      }
    ]
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

// New tests to improve coverage

test('should generate consistent query hash', () => {
  const query1 = 'subscription { onItems { id, offset } }'
  const query2 = 'subscription { onItems { id, offset } }'
  const query3 = 'subscription { onItems { offset, id } }'  // different order

  const hash1 = getQueryHash(query1).toString('hex')
  const hash2 = getQueryHash(query2).toString('hex')
  const hash3 = getQueryHash(query3).toString('hex')

  assert.strictEqual(hash1, hash2, 'Identical queries should have the same hash')
  assert.notStrictEqual(hash1, hash3, 'Different queries should have different hashes')
})

test('should initialize with empty subscriptions', () => {
  const state = new StatefulSubscriptions({
    subscriptions: []
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
  })

  // Add the subscription once
  state.addSubscription('clientId', query)

  // Add the same subscription again
  state.addSubscription('clientId', query)

  // Check that we only have one subscription
  const client = state.clients.get('clientId')
  assert.equal(client?.subscriptions.size, 1)
})

test('should handle unconfigured subscription', () => {
  const query = 'subscription { onUnconfigured { id, someField } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
  })

  // This should not throw an error
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onUnconfigured')

  // The subscription should be added but with empty key and recovery
  assert.ok(subscription)
  assert.strictEqual(subscription?.options.key, '')
  assert.strictEqual(subscription?.options.recovery.key, '')
  assert.strictEqual(subscription?.options.recovery.subscription, '')
})

test('should handle updateSubscriptionState with different value types', () => {
  const query = 'subscription { onItems { id, offset, boolField, nullField } }'
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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
    subscriptions: []
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
    subscriptions: []
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
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      }
    ]
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

test('should restore only subscriptions with lastValue', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      },
      {
        name: 'onUsers',
        key: 'id',
        recovery: {
          key: 'id',
          subscription: 'onUsersRecovery'
        }
      }
    ]
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

  // Should have 2 messages: connection_init and only one recovery subscription
  assert.equal(mockSocket.messages.length, 2)
  assert.equal(mockSocket.messages[0].type, 'connection_init')
  assert.equal(mockSocket.messages[1].type, 'start')

  // Verify only onItems was recovered (since onUsers has no lastValue)
  const payload = mockSocket.messages[1].payload
  assert.ok(payload?.query.includes('onItemsRecovery'))
  assert.ok(!payload?.query.includes('onUsersRecovery'))
})

test('should restore multiple subscriptions with lastValues', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        recovery: {
          key: 'offset',
          subscription: 'onItemsRecovery'
        }
      },
      {
        name: 'onUsers',
        key: 'id',
        recovery: {
          key: 'id',
          subscription: 'onUsersRecovery'
        }
      }
    ]
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
  assert.ok(queries.some(q => q && q.includes('onItemsRecovery(offset: 42)')))
  assert.ok(queries.some(q => q && q.includes('onUsersRecovery(id: "user456")')))
})

test('should handle non-existent client in restoreSubscriptions', () => {
  const state = new StatefulSubscriptions({
    subscriptions: []
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
