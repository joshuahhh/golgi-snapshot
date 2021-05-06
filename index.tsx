import { EventEmitter } from 'fbemitter'
import * as React from 'react'



export class Network extends EventEmitter {
  curTime = 0
  nextId = 0
  cells = {} as {[cellName: string]: Cell<any>}
  evalStack = [] as Array<ComputationCell<any>>;
  debug = false
  sampling = false

  input<T>(initialValue: T): InputCell<T> {
    const name = "__INPUT_" + this.getId()
    const cell: ConstantCell<T> = this.cells[name] = {
      name,
      isAnchor: true,
      changeTime: this.curTime,
      isEvidenceFor: new Set(),

      type: 'constant',
      value: initialValue,
    }

    return {
      get: () => {
        return this._evaluateCell(cell)
      },
      set: (newValue: T) => {
        cell.value = newValue

        this.curTime++
        cell.changeTime = this.curTime
        this.emit('tick')
      },
      delete: () => {
        cell.isAnchor = false
        this._garbageCollect(cell)
      },
    }
  }

  value<T>(name: string, func: () => T, valuesEqual?: (a: T, b: T) => boolean): T {
    if (typeof name !== 'string') {
      throw new Error('value needs a name!')
    }

    if (!this.evalStack.length) {
      throw new Error('value cannot be called outside of an output cell!')
    }

    let cell = this.cells[name]
    if (!cell) {
      cell = this.cells[name] = {
        name,
        isAnchor: false,
        changeTime: null,
        isEvidenceFor: new Set(),

        type: 'computation',
        func,
        valuesEqual,
        status: null,
        evidence: new Set(),
      }
    }

    return this._evaluateCell(cell)
  }

  // TODO: signature of valuesEqual uses any to allow easy use of _.isEqual without making T = any. not great.
  valueFunc<T, U extends Array<any>>(name: string, func: (...args: U) => T, valuesEqual?: (a: any, b: any) => boolean): (...args: U) => T {
    if (typeof name !== 'string') {
      throw new Error('value needs a name!')
    }

    return (...args: U) => {
      const cellName = `${name}(${args.map((arg) => JSON.stringify(arg)).join()})`
      return this.value(cellName, () => func(...args), valuesEqual)
    }
  }

  output<T>(func: () => T, debugName?: string): OutputCell<T> {
    const name = "__OUTPUT_" + (debugName ? debugName + "_" : "") +  this.getId()
    const cell: ComputationCell<T> = this.cells[name] = {
      name,
      isAnchor: true,
      changeTime: null,
      isEvidenceFor: new Set(),

      type: 'computation',
      func,
      status: null,
      evidence: new Set(),
    }

    return new OutputCell(cell, this)
  }

  sample<T>(func: () => T): T {
    if (this.sampling) {
      return func()
    } else {
      this.sampling = true
      const outputCell = this.output(func)
      const result = outputCell.get()
      outputCell.delete()
      this.sampling = false
      return result
    }
  }

  // private stuff

  private getId(): number {
    const id = this.nextId
    this.nextId++
    return id
  }

  _evaluateCell<T>(cell: Cell<T>): T {
    // If this is being called from another cell, mark the dependence
    if (this.evalStack.length) {
      const callingCell = this.evalStack[this.evalStack.length - 1]
      callingCell.evidence.add(cell)
      cell.isEvidenceFor.add(callingCell)
    }

    // If this is a constant cell, do it real quick 'n' easy
    if (cell.type === 'constant') {
      return cell.value
    }

    // Now we can assume we have a computation cell

    // If the cell is patently up-to-date, we're done
    if (cell.status && cell.status.valueTime === this.curTime) {
      return cell.status.value
    }

    // If this is the first evaluation of the cell, do it real quick 'n' easy
    if (!cell.status) {
      this.evalStack.push(cell)
      if (this.debug) { console.group("🌸 " + cell.name) }
      let newValue
      try {
         newValue = cell.func()
      } catch (e) {
        console.error(e)
        throw e
      } finally {
        if (this.debug) { console.log("→", newValue); console.groupEnd() }
        this.evalStack.pop()
      }

      cell.changeTime = this.curTime
      cell.status = {
        value: newValue,
        valueTime: this.curTime,
      }
      return cell.status.value
    }

    // Otherwise, check if any of its ostensible evidence cells have changed
    let evidenceCellChanged = undefined as Cell<any> | undefined
    for (const evidenceCell of cell.evidence) {
      this._evaluateCell(evidenceCell)
      if (evidenceCell.changeTime! > cell.status.valueTime) {
        evidenceCellChanged = evidenceCell
        break
      }
    }
    if (evidenceCellChanged) {
      const oldValue = cell.status.value
      const oldEvidence = cell.evidence

      cell.evidence = new Set()
      this.evalStack.push(cell)
      if (this.debug) {
        console.group("🌸 " + cell.name)
        console.log("input changed: ", evidenceCellChanged.name, getStoredValue(evidenceCellChanged))
      }
      let newValue
      try {
         newValue = cell.func()
      } catch (e) {
        console.error(e)
        throw e
      } finally {
        if (this.debug) { console.log("→", newValue); console.groupEnd() }
        this.evalStack.pop()

        oldEvidence.forEach((oldEvidenceCell) => {
          if (!cell.evidence.has(oldEvidenceCell)) {
            this.isNoLongerEvidenceFor(oldEvidenceCell, cell)
          }
        })
      }

      if (cell.valuesEqual ? !cell.valuesEqual(oldValue, newValue) : oldValue !== newValue) {
        cell.status.value = newValue
        cell.changeTime = this.curTime
        // this.emit('change', {cell, oldValue, newValue})
      }
    }
    cell.status.valueTime = this.curTime

    return cell.status.value
  }

  private isNoLongerEvidenceFor(oldEvidenceCell: Cell<any>, cell: ComputationCell<any>) {
    oldEvidenceCell.isEvidenceFor.delete(cell)
    this._garbageCollect(oldEvidenceCell)
  }

  _garbageCollect(cell: Cell<any>) {
    if (cell.isEvidenceFor.size === 0 && !cell.isAnchor) {
      delete this.cells[cell.name]
      if (cell.type === 'computation') {
        cell.evidence.forEach((oldEvidenceCell) => {
          this.isNoLongerEvidenceFor(oldEvidenceCell, cell)
        })
      }
    }
  }
}

export interface InputCell<T> {
  get(): T,
  set(newValue: T): void,
  delete(): void,
}

export class OutputCell<T> extends EventEmitter {
  private _cell: Cell<T>
  private _network: Network
  // private _tickListener: EventSubscription
  // private _changeListener: EventSubscription

  constructor(cell: Cell<T>, network: Network) {
    super()

    this._cell = cell
    this._network = network

    // TEMP: output cells are now evaluated eagerly
    // this should probably be configurable
    // this._tickListener = this._network.addListener('tick', () => this.get())
    // this._changeListener = this._network.addListener('change', ({cell, oldValue, newValue}: any) => {
    //   if (cell === this._cell) {
    //     this.emit('change', {oldValue, newValue})
    //   }
    // })
  }

  get() {
    if (this._network.evalStack.length) {
      console.log("evalStack", this._network.evalStack)
      console.log("current cell", this._cell)
      throw new Error('output cannot be called inside a cell!')
    }
    return this._network._evaluateCell(this._cell)
  }

  delete() {
    this._cell.isAnchor = false
    this._network._garbageCollect(this._cell)

    // this._tickListener.remove()
    // this._changeListener.remove()
  }

}
// Private, internal

interface CellBasics {
  name: string,
  isAnchor: boolean,
  // run-time
  changeTime: null | number,  // last changed at time _
  isEvidenceFor: Set<ComputationCell<any>>,  // right now, used for garbage-collection only
                                             // could be used for active invalidation
}
interface ConstantCell<T> extends CellBasics {
  type: 'constant',
  // run-time
  value: T,
  changeTime: number,
}
interface ComputationCell<T> extends CellBasics {
  type: 'computation',
  func: () => T,
  valuesEqual?: (a: T, b: T) => boolean,
  // run-time
  status: null | {
    value: T,
    valueTime: number,  // confirmed up-to-date as of time _
  },
  evidence: Set<Cell<any>>,  // insertion order is order accessed in func()
}
type Cell<T> = ConstantCell<T> | ComputationCell<T>

function getStoredValue<T>(cell: Cell<T>): T | null {
  if (cell.type === 'constant') {
    return cell.value
  } else {
    return cell.status && cell.status.value
  }
}



// React stuff

type PropsChanged = (props: any, nextProps: any) => boolean
export interface NetworkContext {
  network: Network,
  propsChanged?: PropsChanged,
}
export const NetworkContextElems = React.createContext<NetworkContext | undefined>(undefined)
interface NetworkProviderProps {
  network: Network,
  propsChanged?: PropsChanged,
  children: React.ReactNode
}
export class NetworkProvider extends React.Component<NetworkProviderProps> {
  // upcomingUpdate: number

  constructor(props: NetworkProviderProps) {
    super(props)

    // props.network.addListener('tick', () => {
    //   if (this.upcomingUpdate) {
    //     cancelAnimationFrame(this.upcomingUpdate)
    //   }
    //   this.upcomingUpdate = requestAnimationFrame(() => {
    //     console.log("FORCING UPDATE")
    //     this.forceUpdate()
    //   })
    // })
  }

  render() {
    const {network, propsChanged, children} = this.props

    return <NetworkContextElems.Provider value={{network, propsChanged}}>
      {children}
    </NetworkContextElems.Provider>
  }
}

interface NetworkUserProps {
  render: () => React.ReactNode,
  props: any,
  state: any,
  debugName?: string,
}
export const NetworkUser = (props: NetworkUserProps) => {


  return <NetworkContextElems.Consumer>
    {(networkContext) => {
      if (!networkContext) {
        throw new Error("Cannot use NetworkUser outside of a NetworkProvider")
      }

      return <NetworkUserHelper networkContext={networkContext} userProps={props}/>
    }}
  </NetworkContextElems.Consumer>
}

interface NetworkUserHelperProps {
  networkContext: NetworkContext,
  userProps: NetworkUserProps,

}
class NetworkUserHelper extends React.Component<NetworkUserHelperProps> {
  outputCell: OutputCell<React.ReactNode> | undefined
  cellShouldUpdate = false

  shouldComponentUpdate(nextProps: NetworkUserHelperProps) {
    // Fun little hack: we use this to figure out when to rewrite the cell
    this.cellShouldUpdate = this.shouldCellUpdate(nextProps)

    return true
  }

  shouldCellUpdate(nextProps: NetworkUserHelperProps) {
    // State is delicate – we assume any setState might break our cell
    if (nextProps.userProps.state !== this.props.userProps.state) {
      return true
    }

    // Hopefully we have a propsChanged function, and can use that to compare props...
    if (this.props.networkContext.propsChanged) {
      if (this.props.networkContext.propsChanged(nextProps.userProps.props, this.props.userProps.props)) {
        return true
      }
    } else if (nextProps.userProps.props !== this.props.userProps.props) {
      return true
    }

    return false
  }

  render() {
    const { userProps: { render, debugName }, networkContext: { network } } = this.props

    if (!this.outputCell || this.cellShouldUpdate) {
      this.cellShouldUpdate = false

      const newOutputCell = network.output(render, debugName)
      const result = newOutputCell.get()
      if (this.outputCell) { this.outputCell.delete() }
      this.outputCell = newOutputCell
      return result
    } else {
      return this.outputCell.get()
    }
  }

  componentWillUnmount() {
    if (this.outputCell) { this.outputCell.delete() }
  }
}
