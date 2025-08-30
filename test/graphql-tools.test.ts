import { extractSubscriptionQueryInfo, extractSubscriptionResultInfo } from '../src/lib/graphql-tools.ts'
import assert from 'assert'
import { test } from 'node:test'

test('should handle FloatValue arguments', () => {
  const query = 'subscription { onItems(price: 99.95) { id, price } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { price: 99.95 })
})

test('should handle BooleanValue arguments', () => {
  const query = 'subscription { onItems(active: true, disabled: false) { id, active } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { active: true, disabled: false })
})

test('should handle NullValue arguments', () => {
  const query = 'subscription { onItems(category: null) { id, category } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { category: null })
})

test('should handle ListValue arguments', () => {
  const query = 'subscription { onItems(tags: ["tag1", "tag2", "tag3"]) { id, tags } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { tags: ['tag1', 'tag2', 'tag3'] })
})

test('should handle ObjectValue arguments', () => {
  const query = 'subscription { onItems(filter: {status: "active", priority: 1}) { id, status } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { filter: { status: 'active', priority: 1 } })
})

test('should handle nested ObjectValue arguments', () => {
  const query = 'subscription { onItems(config: {display: {theme: "dark", lang: "en"}, settings: {auto: true}}) { id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, {
    config: {
      display: { theme: 'dark', lang: 'en' },
      settings: { auto: true }
    }
  })
})

test('should handle Variable arguments with null variables', () => {
  const query = 'subscription($offsetVar: Int) { onItems(offset: $offsetVar) { id, offset } }'
  const variables = {}
  const result = extractSubscriptionQueryInfo(query, variables)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { offset: null })
})

test('should handle Variable arguments with undefined variables', () => {
  const query = 'subscription($offsetVar: Int) { onItems(offset: $offsetVar) { id, offset } }'
  const variables = { offsetVar: undefined }
  const result = extractSubscriptionQueryInfo(query, variables)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { offset: null })
})

test('should handle unknown argument value types gracefully', () => {
  const query = 'subscription { onItems(offset: 42) { id, offset } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { offset: 42 })
})

test('should handle complex nested arguments', () => {
  const query = `
    subscription {
      onItems(
        filter: {
          categories: ["tech", "science"],
          range: { min: 10, max: 100 },
          active: true,
          metadata: null
        }
      ) {
        id
        category
      }
    }
  `
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, {
    filter: {
      categories: ['tech', 'science'],
      range: { min: 10, max: 100 },
      active: true,
      metadata: null
    }
  })
})

test('should handle mixed argument types in lists', () => {
  const query = 'subscription { onItems(mixed: [42, "string", true, null]) { id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { mixed: [42, 'string', true, null] })
})

test('should handle variables in object arguments', () => {
  const query = `
    subscription($status: String!, $priority: Int!) {
      onItems(filter: {status: $status, priority: $priority, auto: true}) {
        id
        status
        priority
      }
    }
  `
  const variables = { status: 'pending', priority: 5 }
  const result = extractSubscriptionQueryInfo(query, variables)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, {
    filter: {
      status: 'pending',
      priority: 5,
      auto: true
    }
  })
})

test('should handle variables in list arguments', () => {
  const query = `
    subscription($tag1: String!, $tag2: String!) {
      onItems(tags: [$tag1, $tag2, "static"]) {
        id
        tags
      }
    }
  `
  const variables = { tag1: 'dynamic1', tag2: 'dynamic2' }
  const result = extractSubscriptionQueryInfo(query, variables)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, {
    tags: ['dynamic1', 'dynamic2', 'static']
  })
})

test('should extract subscription result info correctly', () => {
  const result = {
    onItems: {
      id: 'item123',
      title: 'Test Item',
      count: 42
    }
  }

  const info = extractSubscriptionResultInfo(result)

  assert.equal(info.name, 'onItems')
  assert.equal(info.resultName, 'onItems')
  assert.deepEqual(info.data, {
    id: 'item123',
    title: 'Test Item',
    count: 42
  })
})

test('should extract subscription result info with alias', () => {
  const result = {
    CustomItems: {
      id: 'item456',
      title: 'Aliased Item'
    }
  }

  const info = extractSubscriptionResultInfo(result)

  assert.equal(info.name, 'CustomItems')
  assert.equal(info.resultName, 'CustomItems')
  assert.deepEqual(info.data, {
    id: 'item456',
    title: 'Aliased Item'
  })
})

test('should handle __typename fields by skipping them', () => {
  const query = 'subscription { onItems { id, __typename, title } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['id', 'title'], '__typename should be filtered out')
})

test('should throw error for completely malformed queries', () => {
  const malformedQuery = 'this is not GraphQL at all!'

  assert.throws(() => {
    extractSubscriptionQueryInfo(malformedQuery)
  }, {
    message: 'Error parsing GraphQL query'
  })
})

test('should handle empty object arguments', () => {
  const query = 'subscription { onItems(config: {}) { id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { config: {} })
})

test('should handle empty list arguments', () => {
  const query = 'subscription { onItems(tags: []) { id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { tags: [] })
})

test('should handle fragment spread referencing non-existent fragment', () => {
  const query = 'subscription { onItems { ...nonExistentFragment, id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['id'])
})

test('should handle unknown argument value kind', () => {
  const query = 'subscription { onItems(offset: 42) { id } }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.params, { offset: 42 })
})

test('should handle fragment spread that exists', () => {
  const query = 'subscription { onItems { ...ItemFields } } fragment ItemFields on Item { id, title, status }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['id', 'title', 'status'])
})

test('should handle Enum value arguments (if available)', () => {
  const query = 'subscription { onItems(status: ACTIVE) { id, status } }'

  const result = extractSubscriptionQueryInfo(query)

  assert.equal(result?.name, 'onItems')
  assert.ok('status' in (result?.params || {}))
})

test.only('should extract query info without arguments', () => {
  const query = 'subscription { onItems { id, status } }'

  const result = extractSubscriptionQueryInfo(query)

  assert.equal(result?.name, 'onItems')
  assert.deepEqual(result?.params, {})
})

test('should handle selectionSet with no selections', () => {
  const query = 'subscription { onItems }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, [])
})

test('should handle fragment spread with exact matching', () => {
  const query = 'subscription { onItems { ...ExactMatch } } fragment ExactMatch on Item { id, name }'
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['id', 'name'])
})

test('should handle multiple fragment spreads with mixed existence', () => {
  const query = `
    subscription { 
      onItems { 
        ...ExistingFragment, 
        ...NonExistingFragment, 
        directField 
      } 
    } 
    fragment ExistingFragment on Item { 
      id, 
      title 
    }
  `
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['id', 'title', 'directField'])
})

test('should handle nested fragments with multiple levels', () => {
  const query = `
    subscription { 
      onItems { 
        ...NestedFragment
      } 
    } 
    fragment NestedFragment on Item { 
      basicField,
      nestedObject {
        subField1,
        subField2
      }
    }
  `
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')
  assert.deepEqual(result.fields, ['basicField', 'subField1', 'subField2'], 'Should extract all fields from nested fragment')
})

test('should specifically hit fragment field extraction lines 113-114', () => {
  const query = `
    subscription { 
      onItems { 
        ...ItemFragment
      } 
    } 
    fragment ItemFragment on Item { 
      id,
      title,
      count
    }
  `
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result, 'Result should exist')
  assert.equal(result.name, 'onItems', 'Name should be onItems')

  const expectedFields = ['id', 'title', 'count']
  assert.deepEqual(result.fields, expectedFields, 'Should extract all fields from fragment')

  expectedFields.forEach(field => {
    assert.ok(result.fields.includes(field), `Field ${field} should be included from fragment`)
  })
})

test('should handle multiple fragment definitions and correctly extract from the right one', () => {
  const query = `
    subscription { 
      onItems { 
        ...CorrectFragment
      } 
    } 
    fragment WrongFragment on Item { 
      wrongField1,
      wrongField2
    }
    fragment CorrectFragment on Item { 
      correctField1,
      correctField2,
      correctField3
    }
    fragment AnotherWrongFragment on Item { 
      anotherWrongField
    }
  `
  const result = extractSubscriptionQueryInfo(query)

  assert.ok(result)
  assert.equal(result.name, 'onItems')

  assert.deepEqual(result.fields, ['correctField1', 'correctField2', 'correctField3'], 'Should only extract fields from CorrectFragment')

  assert.ok(!result.fields.includes('wrongField1'), 'Should not include fields from WrongFragment')
  assert.ok(!result.fields.includes('anotherWrongField'), 'Should not include fields from AnotherWrongFragment')
})
