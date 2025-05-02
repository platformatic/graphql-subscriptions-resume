import siphash24 from 'siphash24'
import { parse } from 'graphql'
import type { OperationDefinitionNode, FieldNode, FragmentDefinitionNode, SelectionSetNode } from 'graphql'

export function extractSubscriptionQueryInfo (query: string) {
  try {
    // Parse the GraphQL query string into an AST
    const document = parse(query)

    // Look for a subscription operation
    const subscriptionOperation = document.definitions.find(
      def => def.kind === 'OperationDefinition' && def.operation === 'subscription'
    ) as OperationDefinitionNode | undefined

    // If no subscription operation found, return null
    if (!subscriptionOperation) {
      return null
    }

    // Get the selection set from the subscription operation
    const selectionSet = subscriptionOperation.selectionSet

    // There should be one field at the root level which is the subscription name
    const subscriptionField = selectionSet.selections[0] as FieldNode
    const subscriptionName = subscriptionField.name.value

    // Extract parameters from the subscription field arguments
    const params = extractArguments(subscriptionField.arguments || [])

    // Collect all fragment definitions from the document
    const fragmentDefinitions = document.definitions.filter(
      def => def.kind === 'FragmentDefinition'
    ) as FragmentDefinitionNode[]

    // Extract fields from the subscription
    const fields = extractFields(subscriptionField.selectionSet, fragmentDefinitions)

    return {
      name: subscriptionName,
      fields,
      ...(Object.keys(params).length > 0 ? { params } : {})
    }
  } catch (error) {
    // In case of parsing errors or other issues, return null
    console.error('Error parsing GraphQL query:', error)
    return null
  }
}

// Helper function to extract arguments from field arguments
function extractArguments (args: readonly any[]): Record<string, any> {
  const result: Record<string, any> = {}

  for (const arg of args) {
    const name = arg.name.value
    const value = extractArgumentValue(arg.value)
    result[name] = value
  }

  return result
}

// Helper function to extract a value from an argument
function extractArgumentValue (value: any): any {
  switch (value.kind) {
    case 'IntValue':
      return parseInt(value.value, 10)
    case 'FloatValue':
      return parseFloat(value.value)
    case 'StringValue':
      return value.value
    case 'BooleanValue':
      return value.value
    case 'NullValue':
      return null
    case 'ListValue':
      return value.values.map(extractArgumentValue)
    case 'ObjectValue':
      return extractObjectArguments(value.fields)
    case 'Variable':
      // Variables not supported in this implementation
      return `$${value.name.value}`
    default:
      return null
  }
}

function extractObjectArguments (fields: readonly any[]): Record<string, any> {
  const obj: Record<string, any> = {}
  for (const field of fields) {
    obj[field.name.value] = extractArgumentValue(field.value)
  }
  return obj
}

// Helper function to extract fields from a selection set
function extractFields (
  selectionSet: SelectionSetNode | undefined,
  fragmentDefinitions: FragmentDefinitionNode[]
): string[] {
  if (!selectionSet) {
    return []
  }

  const fields: string[] = []

  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      // Skip internal fields like __typename
      if (selection.name.value === '__typename') {
        continue
      }

      // For leaf fields (without selection sets), add them directly
      if (!selection.selectionSet) {
        fields.push(selection.name.value)
      } else {
        // For objects with nested selection sets, recurse and collect their fields
        const nestedFields = extractFields(selection.selectionSet, fragmentDefinitions)
        fields.push(...nestedFields)
      }
    } else if (selection.kind === 'FragmentSpread') {
      // Find the corresponding fragment definition
      const fragmentName = selection.name.value
      const fragmentDefinition = fragmentDefinitions.find(def => def.name.value === fragmentName)

      if (fragmentDefinition) {
        // Extract fields from the fragment
        const fragmentFields = extractFields(fragmentDefinition.selectionSet, fragmentDefinitions)
        fields.push(...fragmentFields)
      }
    } else if (selection.kind === 'InlineFragment') {
      // Extract fields from inline fragment
      const fragmentFields = extractFields(selection.selectionSet, fragmentDefinitions)
      fields.push(...fragmentFields)
    }
  }

  return fields
}

/**
 * Extracts subscription information from a GraphQL response result
 * @param result The subscription result object
 * @returns Object containing subscription name and result data
 */
export function extractSubscriptionResultInfo (result: Record<string, any>) {
  // Get the name of the subscription (first key in the result object)
  const name = Object.keys(result)[0]

  // Return an object with the subscription name and the data
  return {
    name,
    data: result[name]
  }
}

const siphash24Key = Buffer.from('000000000000000000')
export function getQueryHash (query: string) {
  return siphash24(Buffer.from(query), siphash24Key)
}
