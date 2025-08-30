import { StatefulSubscriptions } from '../src/index.ts'
import assert from 'assert'
import { test } from 'node:test'
import { type Logger } from 'pino'

const createMockLogger = () => {
  const logger = Object.assign(
    () => { },
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

  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload
  const recoveryQuery = payload?.query

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

  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name, email } }')

  state.updateSubscriptionState('clientId', {
    onItems: { id: 'item1', offset: 100, data: 'items data' }
  })

  state.updateSubscriptionState('clientId', {
    onUsers: { id: 'user1', name: 'User One', email: 'user@example.com' }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

  assert.equal(mockSocket.messages.length, 3)

  const queries = mockSocket.messages.slice(1).map(msg => msg.payload?.query)

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

  state.updateSubscriptionState('clientId', {
    onItems: { id: 'test', offset: 50 }
  })

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

  const dataTypesQuery = mockSocket.messages[1].payload?.query

  assert.ok(dataTypesQuery?.includes('stringArg: "string value"'), 'Should properly serialize string args')
  assert.ok(dataTypesQuery?.includes('numberArg: 42'), 'Should properly serialize number args')
  assert.ok(dataTypesQuery?.includes('booleanArg: true'), 'Should properly serialize boolean args')
  assert.ok(dataTypesQuery?.includes('nullArg: null'), 'Should properly serialize null args')
  assert.ok(dataTypesQuery?.includes('objectArg: {"nested":"value"}'), 'Should properly serialize object args')
  assert.ok(dataTypesQuery?.includes('arrayArg: [1,2,3]'), 'Should properly serialize array args')
})

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

  state.updateSubscriptionState('clientId', {
    CustomItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload
  const recoveryQuery = payload?.query

  assert.ok(recoveryQuery?.includes('CustomItems: onItems'), 'Recovery query should include the alias')
  assert.ok(recoveryQuery?.includes('offset: 42'), 'Recovery query should include the key field with value')
  assert.ok(recoveryQuery?.includes('filter: "important"'), 'Recovery query should include the fixed filter arg')
  assert.ok(recoveryQuery?.includes('limit: 10'), 'Recovery query should include the fixed limit arg')
})

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

  state.addSubscription('clientId', query)

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

  state.addSubscription('clientId', query)

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
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  const query = 'subscription { onItems { id, offset, data } }'
  state.addSubscription('clientId', query)

  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

  assert.equal(mockSocket.messages[0].type, 'connection_init')

  const startMessage = mockSocket.messages[1]
  assert.equal(startMessage.type, 'start')
  assert.equal(startMessage.id, 'clientId')

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
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  const query = 'subscription { onItems { id, offset, data } }'
  state.addSubscription('clientId', query)

  const clientBefore = state.clients.get('clientId')
  assert.equal(clientBefore?.subscriptions.size, 1)
  assert.ok(clientBefore?.subscriptions.has('onItems'))

  state.removeAllSubscriptions('clientId')

  const clientAfter = state.clients.get('clientId')
  assert.equal(clientAfter?.subscriptions.size, 0)
})

test('should handle removing subscriptions for non-existent client', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

  state.removeAllSubscriptions('nonExistentClient')

  assert.equal(state.clients.has('nonExistentClient'), false)
})

test('should remove all subscriptions for a client with multiple subscriptions', () => {
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

  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name, email } }')

  const clientBefore = state.clients.get('clientId')
  assert.equal(clientBefore?.subscriptions.size, 2)
  assert.ok(clientBefore?.subscriptions.has('onItems'))
  assert.ok(clientBefore?.subscriptions.has('onUsers'))

  state.removeAllSubscriptions('clientId')

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
  assert.equal(subscription?.lastValue, 120)
  assert.deepEqual(subscription?.params, { offset: 100 })
})

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

  state.addSubscription('clientId', query)

  state.addSubscription('clientId', query)

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

  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123'

    }
  })

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')

  assert.strictEqual(subscription?.lastValue, null)
})

test('should handle updateSubscriptionState for non-existent client', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [],
    logger: createMockLogger()
  })

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

  state.addSubscription('clientId', 'subscription { onItems { id } }')

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

  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name } }')

  state.updateSubscriptionState('clientId', {
    onItems: {
      id: 'id123',
      offset: 42,
      data: 'some data'
    }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

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

  state.addSubscription('clientId', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { onUsers { id, name } }')

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

  state.restoreSubscriptions('clientId', mockSocket)

  assert.equal(mockSocket.messages.length, 3)
  assert.equal(mockSocket.messages[0].type, 'connection_init')
  assert.equal(mockSocket.messages[1].type, 'start')
  assert.equal(mockSocket.messages[2].type, 'start')

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

  const query = 'subscription { Items: onItems { id, offset, field1, field2 } }'
  state.addSubscription('clientId', query)

  const client = state.clients.get('clientId')
  assert.ok(client?.subscriptions.has('Items'))

  const subscription = client?.subscriptions.get('Items')
  assert.equal(subscription?.name, 'onItems')
  assert.equal(subscription?.alias, 'Items')
  assert.deepEqual(subscription?.fields, ['id', 'offset', 'field1', 'field2'])

  state.updateSubscriptionState('clientId', {
    Items: {
      id: 'trade123',
      offset: 100,
      field1: 'value1',
      field2: 'value2'
    }
  })

  assert.equal(subscription?.lastValue, 100)

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

  state.restoreSubscriptions('clientId', mockSocket)

  const startMessage = mockSocket.messages[1]
  assert.equal(startMessage.type, 'start')

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

  state.restoreSubscriptions('nonExistentClient', mockSocket)

  assert.equal(mockSocket.messages.length, 0)
})

test('should handle error thrown from extractSubscriptionQueryInfo', () => {
  let loggedError: any = null
  let loggedMsg: string | null = null

  const mockLogger = {
    error: (obj: { err: any }, msg: string) => {
      loggedError = obj.err
      loggedMsg = msg
    },
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

  const invalidQuery = 'subscription { this is completely invalid GraphQL! }'

  const result = state.addSubscription('clientId', invalidQuery)
  assert.equal(result, undefined)

  assert.notEqual(loggedError, null, 'Expected an error to be logged')
  assert.equal(loggedMsg, 'Error parsing GraphQL query', 'Expected specific error message')

  const client = state.clients.get('clientId')
  assert.ok(client, 'Client state should be created')
  assert.equal(client.subscriptions.size, 0, 'No subscription should have been added')
})

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

  state.updateSubscriptionState('clientId', {
    CustomItems: {
      id: 'id-aliased',
      offset: 200,
      data: 'aliased data'
    }
  })

  const client = state.clients.get('clientId')

  const subscription = client?.subscriptions.get('CustomItems')
  assert.deepEqual(subscription?.lastValue, 200)

  assert.equal(subscription?.name, 'onItems')
  assert.equal(subscription?.alias, 'CustomItems')
})

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

  state.addSubscription('clientId', 'subscription { FirstItems: onItems { id, offset, data } }')
  state.addSubscription('clientId', 'subscription { SecondItems: onItems { id, offset, data } }')

  const client = state.clients.get('clientId')
  assert.equal(client?.subscriptions.size, 2)
  assert.ok(client?.subscriptions.has('FirstItems'))
  assert.ok(client?.subscriptions.has('SecondItems'))

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

  const firstSub = client?.subscriptions.get('FirstItems')
  const secondSub = client?.subscriptions.get('SecondItems')

  assert.equal(firstSub?.lastValue, 10)
  assert.equal(secondSub?.lastValue, 20)

  assert.equal(firstSub?.name, 'onItems')
  assert.equal(secondSub?.name, 'onItems')
})

test('should inject missing key field in subscription', () => {
  const query = 'subscription { onItems { id, data } }'
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

  assert.ok(subscription?.injectedKey, 'Subscription should be flagged as having injected key')
  assert.ok(subscription?.fields.includes('offset'), 'Key field should have been injected')
  assert.deepEqual(subscription?.fields, ['id', 'data', 'offset'], 'Fields should include injected key')
})

test('should remove injected key field from results', () => {
  const query = 'subscription { onItems { id, data } }'
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

  const result = {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  state.updateSubscriptionState('clientId', result)

  assert.ok(!('offset' in result.onItems), 'Key field should be removed from result')
  assert.deepEqual(result.onItems, { id: 'item123', data: 'some data' }, 'Result should not contain the key field')

  const client = state.clients.get('clientId')
  const subscription = client?.subscriptions.get('onItems')
  assert.equal(subscription?.lastValue, 42, 'lastValue should be set from the key field')
})

test('should not remove key field if it was not injected', () => {
  const query = 'subscription { onItems { id, data, offset } }'
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

  const result = {
    onItems: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  const originalResult = JSON.parse(JSON.stringify(result))

  state.updateSubscriptionState('clientId', result)

  assert.ok('offset' in result.onItems, 'Key field should not be removed from result')
  assert.deepEqual(result.onItems, originalResult.onItems, 'Result should be unchanged')
})

test('should work with aliases when injecting key field', () => {
  const query = 'subscription { Items: onItems { id, data } }'
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

  assert.ok(subscription?.injectedKey, 'Subscription should be flagged as having injected key')
  assert.ok(subscription?.fields.includes('offset'), 'Key field should have been injected')

  const result = {
    Items: {
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  }

  state.updateSubscriptionState('clientId', result)

  assert.ok(!('offset' in result.Items), 'Key field should be removed from aliased result')
  assert.deepEqual(result.Items, { id: 'item123', data: 'some data' }, 'Result should not contain the key field')

  assert.equal(subscription?.lastValue, 42, 'lastValue should be set from the key field')
})

test('should include injected field in recovery query', () => {
  const query = 'subscription { onItems { id, data } }'
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
      id: 'item123',
      data: 'some data',
      offset: 42
    }
  })

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

  state.restoreSubscriptions('clientId', mockSocket)

  const startMessage = mockSocket.messages[1]
  const payload = startMessage.payload

  assert.ok(payload?.query.includes('id'), 'Recovery query should include original fields')
  assert.ok(payload?.query.includes('data'), 'Recovery query should include original fields')
  assert.ok(payload?.query.includes('offset'), 'Recovery query should include injected key field')
})

test('should work without logger for all methods', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset',
        args: {
          filter: 'important'
        }
      },
      {
        name: 'onUsers',
        key: 'id'
      }
    ],
    logger: undefined as unknown as Logger
  })

  const clientState = state.createClientState()
  assert.ok(clientState, 'createClientState should work without logger')
  assert.ok(clientState.subscriptions instanceof Map, 'should return proper client state')

  const query = 'subscription { onItems { id, offset, data } }'

  state.addSubscription('client1', query)

  const client = state.clients.get('client1')
  assert.ok(client, 'Client should be created')
  assert.equal(client.subscriptions.size, 1, 'Subscription should be added')

  const subscription = client.subscriptions.get('onItems')
  assert.ok(subscription, 'Subscription should exist')
  assert.equal(subscription.name, 'onItems', 'Subscription name should be correct')
  assert.deepEqual(subscription.fields, ['id', 'offset', 'data'], 'Subscription fields should be correct')

  state.addSubscription('client2', query, { lastValue: 50 })
  const client2 = state.clients.get('client2')
  const subscription2 = client2?.subscriptions.get('onItems')
  assert.equal(subscription2?.lastValue, 50, 'lastValue from variables should work')

  const queryWithoutKey = 'subscription { onItems { id, data } }'
  state.addSubscription('client3', queryWithoutKey)
  const client3 = state.clients.get('client3')
  const subscription3 = client3?.subscriptions.get('onItems')
  assert.ok(subscription3?.injectedKey, 'Key injection should work without logger')
  assert.ok(subscription3?.fields.includes('offset'), 'Injected key should be in fields')

  state.addSubscription('client4', 'invalid graphql query')
  const client4 = state.clients.get('client4')
  assert.equal(client4?.subscriptions.size, 0, 'Invalid query should not add subscription')

  state.updateSubscriptionState('client1', {
    onItems: {
      id: 'item123',
      offset: 100,
      data: 'test data'
    }
  })

  const updatedSubscription = client?.subscriptions.get('onItems')
  assert.equal(updatedSubscription?.lastValue, 100, 'updateSubscriptionState should work without logger')

  state.updateSubscriptionState('client3', {
    onItems: {
      id: 'item456',
      data: 'test data',
      offset: 200
    }
  })
  const updatedSubscription3 = client3?.subscriptions.get('onItems')
  assert.equal(updatedSubscription3?.lastValue, 200, 'updateSubscriptionState should update lastValue')

  state.updateSubscriptionState('nonExistentClient', {
    onItems: { id: 'test', offset: 1 }
  })

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

  state.restoreSubscriptions('client1', mockSocket)

  assert.equal(mockSocket.messages.length, 2, 'Should send connection_init and start messages')
  assert.equal(mockSocket.messages[0].type, 'connection_init', 'First message should be connection_init')
  assert.equal(mockSocket.messages[1].type, 'start', 'Second message should be start')
  assert.ok(mockSocket.messages[1].payload?.query.includes('offset: 100'), 'Recovery query should include last value')

  const mockSocket2 = {
    messages: [] as Array<any>,
    send (message: string) {
      this.messages.push(JSON.parse(message))
    }
  }
  state.restoreSubscriptions('nonExistentClient', mockSocket2)
  assert.equal(mockSocket2.messages.length, 0, 'Should not send messages for non-existent client')

  state.removeAllSubscriptions('client1')

  const clientAfterRemoval = state.clients.get('client1')
  assert.equal(clientAfterRemoval?.subscriptions.size, 0, 'removeAllSubscriptions should work without logger')

  state.removeAllSubscriptions('nonExistentClient')

  state.addSubscription('multiClient', 'subscription { onItems { id, offset, data } }')
  state.addSubscription('multiClient', 'subscription { onUsers { id, name } }')

  const multiClient = state.clients.get('multiClient')
  assert.equal(multiClient?.subscriptions.size, 2, 'Should handle multiple subscriptions without logger')

  state.addSubscription('aliasClient', 'subscription { CustomItems: onItems { id, offset, data } }')
  const aliasClient = state.clients.get('aliasClient')
  const aliasSubscription = aliasClient?.subscriptions.get('CustomItems')
  assert.ok(aliasSubscription, 'Should handle aliases without logger')
  assert.equal(aliasSubscription?.alias, 'CustomItems', 'Alias should be stored correctly')
})

test('should handle updateSubscriptionState edge case where subscription is undefined', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  const client = state.createClientState()
  state.clients.set('testClient', client)

  client.subscriptions.set('testSubscription', undefined as any)

  state.updateSubscriptionState('testClient', {
    testSubscription: {
      id: 'test123',
      offset: 42
    }
  })

  assert.ok(true, 'Should handle undefined subscription gracefully')
})

test('should handle updateSubscriptionState where config is missing', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('testClient', 'subscription { onItems { id, offset } }')

  const client = state.clients.get('testClient')
  const subscription = client?.subscriptions.get('onItems')

  if (subscription) {
    subscription.name = 'nonExistentSubscription'
  }

  state.updateSubscriptionState('testClient', {
    onItems: {
      id: 'test123',
      offset: 42
    }
  })

  assert.ok(true, 'Should handle missing config gracefully')
})

test('should handle subscription with no lastValue params when no key exists', () => {
  const state = new StatefulSubscriptions({
    subscriptions: [
      {
        name: 'onItems',
        key: 'offset'
      }
    ],
    logger: createMockLogger()
  })

  state.addSubscription('testClient', 'subscription { onItems { id, offset } }')

  state.updateSubscriptionState('testClient', {
    onItems: {
      id: 'test123'

    }
  })

  const client = state.clients.get('testClient')
  const subscription = client?.subscriptions.get('onItems')

  assert.strictEqual(subscription?.lastValue, null, 'lastValue should remain null when keyValue is undefined')
})
