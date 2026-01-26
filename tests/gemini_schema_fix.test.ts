
import { toGeminiFunctions } from '../src/features/llm/providers/gemini';
import { LLMTool } from '../src/features/llm/providers/types';
import { SchemaType } from '@google/generative-ai';

const testTool: LLMTool = {
    name: 'test_tool',
    description: 'Test tool with integer enums',
    parameters: {
        type: 'object',
        properties: {
            days: {
                type: 'integer',
                enum: [1, 2, 3],
                description: 'Number of days'
            },
            unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'Temperature unit'
            }
        },
        required: ['days']
    }
};

const result = toGeminiFunctions([testTool]);

if (result && result.length > 0) {
    const params = result[0].parameters as any;
    console.log(JSON.stringify(params, null, 2));

    let success = true;

    // Check days enum
    const daysProp = params.properties.days;
    if (daysProp.type !== SchemaType.STRING) {
        console.error('FAIL: days type should be STRING, got', daysProp.type);
        success = false;
    }
    if (!daysProp.enum.every((v: any) => typeof v === 'string')) {
        console.error('FAIL: days enum values should be strings', daysProp.enum);
        success = false;
    }

    // Check unit enum (should remain strings)
    const unitProp = params.properties.unit;
    if (unitProp.type !== SchemaType.STRING) { // Although it was string, sanitization sets it to STRING (enum logic)
        // Actually my logic sets type to string if enum exists. 
        // Original type was string. 
    }
    if (!unitProp.enum.every((v: any) => typeof v === 'string')) {
        console.error('FAIL: unit enum values should be strings', unitProp.enum);
        success = false;
    }

    if (success) {
        console.log('SUCCESS: Schema sanitized correctly');
    } else {
        process.exit(1);
    }

} else {
    console.error('FAIL: No functions returned');
    process.exit(1);
}
