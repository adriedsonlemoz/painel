function fail(path, message) { return `${path || '$'} ${message}` }

export function validateJsonSchema(value, schema, path = '$') {
  const errors = []
  if (!schema || typeof schema !== 'object') return { ok: true, errors }
  const type = schema.type
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: [fail(path, 'deve ser objeto')] }
    for (const key of schema.required || []) if (!(key in value)) errors.push(fail(`${path}.${key}`, 'é obrigatório'))
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push(fail(`${path}.${key}`, 'não é permitido'))
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateJsonSchema(value[key], child, `${path}.${key}`).errors)
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return { ok: false, errors: [fail(path, 'deve ser lista')] }
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(fail(path, `deve ter no máximo ${schema.maxItems} item(ns)`))
    if (schema.minItems != null && value.length < schema.minItems) errors.push(fail(path, `deve ter no mínimo ${schema.minItems} item(ns)`))
    if (schema.items) value.forEach((item, i) => errors.push(...validateJsonSchema(item, schema.items, `${path}[${i}]`).errors))
  } else if (type === 'string') {
    if (typeof value !== 'string') errors.push(fail(path, 'deve ser texto'))
    if (typeof value === 'string' && schema.enum && !schema.enum.includes(value)) errors.push(fail(path, `deve ser um de: ${schema.enum.join(', ')}`))
    if (typeof value === 'string' && schema.maxLength != null && value.length > schema.maxLength) errors.push(fail(path, `excede ${schema.maxLength} caracteres`))
  } else if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value) || (type === 'integer' && !Number.isInteger(value))) errors.push(fail(path, `deve ser ${type === 'integer' ? 'inteiro' : 'número'}`))
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(fail(path, 'deve ser booleano'))
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(fail(path, `deve ser um de: ${schema.enum.join(', ')}`))
  return { ok: errors.length === 0, errors }
}
