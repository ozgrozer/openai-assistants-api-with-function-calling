require('dotenv').config()
const axios = require('axios')
const { OpenAI } = require('openai')
const readlineSync = require('readline-sync')

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

global.getStockPrice = async ({ symbol }) => {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
  const response = await axios.get(url)
  return response.data['Global Quote']['05. price']
}

const main = async () => {
  console.log('Hey there, I am your personal assistant')
  console.log('Type q to quit')

  const assistant = await openai.beta.assistants.create({
    name: 'Data Analyst',
    model: 'gpt-3.5-turbo-0125',
    instructions: 'You are a data analyst',
    tools: [{
      type: 'function',
      function: {
        name: 'getStockPrice',
        description: 'Get company’s current stock price using its symbol',
        parameters: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Stock symbol (e.g. NVDA for Nvidia)'
            }
          },
          required: ['symbol']
        }
      }
    }]
  })

  const thread = await openai.beta.threads.create()

  while (true) {
    const userPrompt = readlineSync.question('\nPrompt: ')
    if (userPrompt === 'q') break

    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userPrompt
    })

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id
    })

    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id)

    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000))
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id)

      if (runStatus.status === 'requires_action') {
        const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const args = JSON.parse(toolCall.function.arguments)
          const output = await global[functionName].apply(null, [args])
          toolOutputs.push({ output, tool_call_id: toolCall.id })
        }

        await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
          tool_outputs: toolOutputs
        })
        continue
      }

      if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
        console.log(`Run status is '${runStatus.status}'`)
        break
      }
    }

    const messages = await openai.beta.threads.messages.list(thread.id)
    const lastMessage = messages.data
      .filter(msg => msg.run_id === run.id && msg.role === 'assistant')
      .pop()
    console.log(lastMessage.content[0].text.value)
  }
}

main()
