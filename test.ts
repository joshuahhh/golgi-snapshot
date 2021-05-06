import { Network } from './index'
// import { Network, ValueListener } from './index'

test('simple example: inputs & outputs', () => {
  const network = new Network()
  network.debug = false

  const a = network.input(3)
  const b = network.input(4)

  const c = network.output(() => a.get() + b.get())

  expect( c.get() ).toEqual( 7 )

  b.set(40);
  expect( c.get() ).toEqual( 43 )
})

test('simple example with an intermediate value', () => {
  const network = new Network()
  network.debug = false

  const a = network.input(3)
  const b = network.input(4)

  let aSquaredRuns = 0;

  const c = network.output(() => {
    const aSquared = network.value('aSquared', () => (aSquaredRuns++, a.get() ** 2));
    return aSquared + b.get();
  })

  expect( c.get() ).toEqual( 13 )
  expect( aSquaredRuns ).toEqual( 1 )

  b.set(40);
  expect( c.get() ).toEqual( 49 )
  expect( aSquaredRuns ).toEqual( 1 )  // it doesn't re-run, even though c is recomputed
})


test('variables example', () => {
  type VarDef =
    {type: 'constant', value: number} |
    {type: '+' | '*', inputs: Array<string>}

  type Document = {[varName: string]: VarDef}

  const document1: Document  = {
    a: { type: 'constant', value: 3 },
    b: { type: 'constant', value: 4 },
    c: { type: '+', inputs: ['a', 'b'] },
  }

  const network = new Network()
  network.debug = false

  const documentInput = network.input(document1)

  const getVarDef = (varName: string) => {
    return network.value(varName + '-def', () => {
      const document = documentInput.get()
      return document[varName]
    })
  }

  const getVarValue = (varName: string): number => {
    return network.value(varName + '-value', () => {
      const varDef = getVarDef(varName)
      if (varDef.type === 'constant') {
        return varDef.value
      } else {
        const inputValues = varDef.inputs.map((varName) => getVarValue(varName))
        return inputValues.reduce(varDef.type === '+' ? (a, b) => a + b : (a, b) => a * b)
      }
    })
  }

  const cOutput = network.output(() => getVarValue('c'))

  expect( cOutput.get() ).toEqual( 7 )

  console.log("setting a == 100")

  const document2: Document = {...document1, a: { type: 'constant', value: 100 }}
  documentInput.set(document2)

  expect( cOutput.get() ).toEqual( 104 )

  console.log("setting c == + b")

  const document3: Document = {...document2, c: { type: '+', inputs: ['b']}}
  documentInput.set(document3)

  expect( cOutput.get() ).toEqual( 4 )

  cOutput.delete()

  expect( Object.keys(network.cells).length ).toEqual( 1 )

})


test('variables example (valueFunc)', () => {
  type VarDef =
    {type: 'constant', value: number} |
    {type: '+' | '*', inputs: Array<string>}

  type Document = {[varName: string]: VarDef}

  const document1: Document  = {
    a: { type: 'constant', value: 3 },
    b: { type: 'constant', value: 4 },
    c: { type: '+', inputs: ['a', 'b'] },
  }

  const network = new Network()
  network.debug = false

  const documentInput = network.input(document1)

  const getVarDef = network.valueFunc('getVarDef', (varName: string) => {
    const document = documentInput.get()
    return document[varName]
  })

  const getVarValue = network.valueFunc('getVarValue', (varName: string): number => {
    const varDef = getVarDef(varName)
    if (varDef.type === 'constant') {
      return varDef.value
    } else {
      const inputValues = varDef.inputs.map((varName) => getVarValue(varName))
      return inputValues.reduce(varDef.type === '+' ? (a, b) => a + b : (a, b) => a * b)
    }
  })

  const cOutput = network.output(() => getVarValue('c'))

  expect( cOutput.get() ).toEqual( 7 )

  console.log("setting a == 100")

  const document2: Document = {...document1, a: { type: 'constant', value: 100 }}
  documentInput.set(document2)

  expect( cOutput.get() ).toEqual( 104 )

  console.log("setting c == + b")

  const document3: Document = {...document2, c: { type: '+', inputs: ['b']}}
  documentInput.set(document3)

  expect( cOutput.get() ).toEqual( 4 )

  cOutput.delete()

  expect( Object.keys(network.cells).length ).toEqual( 1 )

})

// DISABLED cuz we changed outputs to not run automatically (React nonsense)
xtest('listening to changes on output cells', () => {
  type VarDef =
    {type: 'constant', value: number} |
    {type: '+' | '*', inputs: Array<string>}

  type Document = {[varName: string]: VarDef}

  const document1: Document  = {
    a: { type: 'constant', value: 3 },
    b: { type: 'constant', value: 4 },
    c: { type: '+', inputs: ['a', 'b'] },
  }

  const network = new Network()
  network.debug = false

  const documentInput = network.input(document1)

  const getVarDef = network.valueFunc('getVarDef', (varName: string) => {
    const document = documentInput.get()
    return document[varName]
  })

  const getVarValue = network.valueFunc('getVarValue', (varName: string): number => {
    const varDef = getVarDef(varName)
    if (varDef.type === 'constant') {
      return varDef.value
    } else {
      const inputValues = varDef.inputs.map((varName) => getVarValue(varName))
      return inputValues.reduce(varDef.type === '+' ? (a, b) => a + b : (a, b) => a * b)
    }
  })

  const cOutput = network.output(() => getVarValue('c'))

  expect( cOutput.get() ).toEqual( 7 )

  let networkTicked
  let cellChanged
  network.addListener('tick', () => networkTicked = true)
  cOutput.addListener('change', () => cellChanged = true)

  console.log("setting a == 100")
  networkTicked = cellChanged = false

  const document2: Document = {...document1, a: { type: 'constant', value: 100 }}
  documentInput.set(document2)

  expect( cOutput.get() ).toEqual( 104 )
  expect( networkTicked ).toEqual( true )
  expect( cellChanged ).toEqual( true )

  console.log("setting a == 100 again")
  networkTicked = cellChanged = false

  documentInput.set(document2)

  expect( cOutput.get() ).toEqual( 104 )
  expect( networkTicked ).toEqual( true )
  expect( cellChanged ).toEqual( false )
})

test('sampling works', () => {
  const network = new Network()
  network.debug = false

  const input = network.input(10)

  let inputPlus5Runs = 0
  const inputPlus5 = network.valueFunc('inputPlus5', () => {
    inputPlus5Runs++
    return input.get() + 5
  })

  expect(() => inputPlus5()).toThrow()
  expect(network.sample(() => inputPlus5())).toEqual(15)
  expect(inputPlus5Runs).toEqual(1)
  expect(network.sample(() => network.sample(() => inputPlus5()))).toEqual(15)
  expect(inputPlus5Runs).toEqual(2)  // it's been garbage collected! yay
})

test('memoization example', () => {
  const network = new Network()
  network.debug = false

  // this is neat: no inputs needed, for "purely functional" use

  let fibRuns = 0
  const fib = network.valueFunc('fib', (n: number): number => {
    fibRuns++
    return n < 2 ? n : fib(n - 1) + fib(n - 2)
  })

  expect(network.sample(() => fib(10))).toEqual(55)
  expect(fibRuns).toEqual(11)

  // but note that memoized values don't stick around between calls to "sample"
  expect(network.sample(() => fib(10))).toEqual(55)
  expect(fibRuns).toEqual(22)

  // UNLESS we maintain references to them with an output
  const fib10 = network.output(() => fib(10))
  expect(fibRuns).toEqual(22)
  expect(fib10.get()).toEqual(55)
  expect(fibRuns).toEqual(33)
  expect(fib10.get()).toEqual(55)
  expect(fibRuns).toEqual(33)

  // and now even direct use of fib(10) is memoized
  expect(network.sample(() => fib(10))).toEqual(55)
  expect(fibRuns).toEqual(33)
})