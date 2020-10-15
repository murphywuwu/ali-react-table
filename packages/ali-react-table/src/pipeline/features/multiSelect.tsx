import React from 'react'
import { ArtColumn, ArtColumnStaticPart, CellProps } from '../../interfaces'
import { internals } from '../../internals'
import { TablePipeline } from '../pipeline'

function diffArray(arr1: string[], arr2: string[]) {
  const set = new Set(arr2)
  return arr1.filter((x) => !set.has(x))
}

function mergeArray(arr1: string[], arr2: string[]) {
  const set = new Set(arr1)
  return arr1.concat(arr2.filter((x) => !set.has(x)))
}

export interface MultiSelectFeatureOptions {
  /** 非受控用法：默认选中的值 */
  defaultValue?: string[]

  /** 非受控用法：默认 lastKey */
  defaultLastKey?: string

  /** 受控用法：当前选中的 keys */
  value?: string[]

  /** 受控用法：上一次操作对应的 rowKey */
  lastKey?: string

  /** 受控用法：状态改变回调  */
  onChange?: (
    nextValue: string[],
    key: string,
    keys: string[],
    action: 'check' | 'uncheck' | 'check-all' | 'uncheck-all',
  ) => void

  /** 复选框所在列的位置 */
  checkboxPlacement?: 'start' | 'end'

  /** 复选框所在列的 column 配置，可指定 width，lock, title, align, features 等属性 */
  checkboxColumn?: Partial<ArtColumnStaticPart>

  /** 是否高亮被选中的行 */
  highlightRowWhenSelected?: boolean

  /** 判断一行中的 checkbox 是否要禁用 */
  isDisabled?(row: any, rowIndex: number): boolean

  /** 点击事件的响应区域 */
  clickArea?: 'checkbox' | 'cell' | 'row'

  /** 是否对触发 onChange 的 click 事件调用 event.stopPropagation() */
  stopClickEventPropagation?: boolean
}

export function multiSelect(opts: MultiSelectFeatureOptions = {}) {
  return function multiSelectStep<P extends TablePipeline>(pipeline: P) {
    const stateKey = 'multiSelect'
    const Checkbox = pipeline.ctx.components.Checkbox
    if (Checkbox == null) {
      throw new Error('使用 multiSelect 之前需要设置 pipeline.ctx.components.Checkbox')
    }
    const primaryKey = pipeline.ensurePrimaryKey('multiSelect')

    const isDisabled = opts.isDisabled ?? (() => false)
    const clickArea = opts.clickArea ?? 'checkbox'

    const value: string[] = opts.value ?? pipeline.state[stateKey]?.value ?? opts.defaultValue ?? []
    const lastKey: string = opts.lastKey ?? pipeline.state[stateKey]?.lastKey ?? opts.defaultLastKey ?? ''
    const onChange: MultiSelectFeatureOptions['onChange'] = (nextValue, key, keys, action) => {
      opts.onChange?.(nextValue, key, keys, action)
      pipeline.setStateAtKey(stateKey, { value: nextValue, lastKey: key }, { keys, action })
    }

    const allKeys = pipeline
      .getDataSource()
      .map((record, rowIndex) => {
        // 在 allKeys 中排除被禁用的 key
        if (isDisabled(record, rowIndex)) {
          return null
        }
        return internals.safeGetRowKey(primaryKey, record, rowIndex)
      })
      .filter((key) => key != null)

    const set = new Set(value)
    const isAllChecked = allKeys.length > 0 && allKeys.every((key) => set.has(key))
    const isAnyChecked = allKeys.some((key) => set.has(key))

    const defaultCheckboxColumnTitle = (
      <Checkbox
        checked={isAllChecked}
        indeterminate={!isAllChecked && isAnyChecked}
        onChange={(_: any) => {
          if (isAllChecked) {
            onChange(diffArray(value, allKeys), '', allKeys, 'uncheck-all')
          } else {
            onChange(mergeArray(value, allKeys), '', allKeys, 'check-all')
          }
        }}
      />
    )

    const checkboxColumn: ArtColumn = {
      name: '是否选中',
      title: defaultCheckboxColumnTitle,
      width: 50,
      align: 'center',
      ...opts.checkboxColumn,
      getCellProps(value: any, row: any, rowIndex: number): CellProps {
        if (clickArea === 'cell') {
          const key = internals.safeGetRowKey(primaryKey, row, rowIndex)
          const prevChecked = set.has(key)
          const disabled = isDisabled(row, rowIndex)
          return {
            style: { cursor: disabled ? 'not-allowed' : 'pointer' },
            onClick: disabled
              ? undefined
              : (e) => {
                  if (opts.stopClickEventPropagation) {
                    e.stopPropagation()
                  }
                  onCheckboxChange(prevChecked, key, e.shiftKey)
                },
          }
        }
      },
      render(_: any, row: any, rowIndex: number) {
        const key = internals.safeGetRowKey(primaryKey, row, rowIndex)
        const checked = set.has(key)
        return (
          <Checkbox
            checked={checked}
            disabled={isDisabled(row, rowIndex)}
            onChange={
              clickArea === 'checkbox'
                ? (arg1: any, arg2: any) => {
                    // 这里要同时兼容 antd 和 fusion 的用法
                    // fusion: arg2?.nativeEvent
                    // antd: arg1.nativeEvent
                    const nativeEvent: MouseEvent = arg2?.nativeEvent ?? arg1.nativeEvent
                    if (nativeEvent) {
                      if (opts.stopClickEventPropagation) {
                        nativeEvent.stopPropagation()
                      }
                      onCheckboxChange(checked, key, nativeEvent.shiftKey)
                    }
                  }
                : undefined
            }
          />
        )
      },
    }

    const nextColumns = pipeline.getColumns().slice()
    const checkboxPlacement = opts.checkboxPlacement ?? 'start'
    if (checkboxPlacement === 'start') {
      nextColumns.unshift(checkboxColumn)
    } else {
      nextColumns.push(checkboxColumn)
    }
    pipeline.columns(nextColumns)

    pipeline.appendRowPropsGetter((row, rowIndex) => {
      const rowKey = internals.safeGetRowKey(primaryKey, row, rowIndex)
      let style: any = {}
      let className: string
      let onClick: any

      const checked = set.has(rowKey)
      if (opts.highlightRowWhenSelected) {
        if (checked) {
          className = 'highlight'
        }
      }

      if (clickArea === 'row') {
        const disabled = isDisabled(row, rowIndex)
        if (!disabled) {
          style.cursor = 'pointer'
          onClick = (e: MouseEvent) => {
            if (opts.stopClickEventPropagation) {
              e.stopPropagation()
            }
            onCheckboxChange(checked, rowKey, e.shiftKey)
          }
        }
      }

      return { className, style, onClick }
    })

    return pipeline

    function onCheckboxChange(prevChecked: boolean, key: string, batch: boolean) {
      let batchKeys = [key]

      if (batch && lastKey) {
        const lastIdx = allKeys.indexOf(lastKey)
        const cntIdx = allKeys.indexOf(key)
        const [start, end] = lastIdx < cntIdx ? [lastIdx, cntIdx] : [cntIdx, lastIdx]
        batchKeys = allKeys.slice(start, end + 1)
      }

      if (prevChecked) {
        onChange(diffArray(value, batchKeys), key, batchKeys, 'uncheck')
      } else {
        onChange(mergeArray(value, batchKeys), key, batchKeys, 'check')
      }
    }
  }
}