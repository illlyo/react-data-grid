import React from 'react';
import PropTypes from 'prop-types';

import SelectionMask from './SelectionMask';
import CopyMask from './CopyMask';
import DragMask from './DragMask';
import DragHandle from './DragHandle';
import EditorContainer from '../editors/EditorContainer';
import { isKeyPrintable, isCtrlKeyHeldDown } from '../utils/keyboardUtils';
import {
  getSelectedDimensions,
  getSelectedCellValue,
  getSelectedRow,
  getSelectedColumn,
  getNextSelectedCellPosition,
  isSelectedCellEditable
} from '../utils/SelectedCellUtils';
import isFunction from '../utils/isFunction';
import * as AppConstants from '../AppConstants';
import * as keyCodes from '../KeyCodes';
import * as EventTypes from './EventTypes';

const SCROLL_CELL_BUFFER = 2;

class InteractionMasks extends React.Component {
  static propTypes = {
    colVisibleStart: PropTypes.number,
    colVisibleEnd: PropTypes.number,
    visibleStart: PropTypes.number,
    visibleEnd: PropTypes.number,
    columns: PropTypes.array,
    rowHeight: PropTypes.number,
    onHitBottomBoundary: PropTypes.func,
    onHitTopBoundary: PropTypes.func,
    onHitRightBoundary: PropTypes.func,
    onHitLeftBoundary: PropTypes.func,
    onCommit: PropTypes.func,
    onCommitCancel: PropTypes.func,
    isEditorEnabled: PropTypes.bool,
    firstEditorKeyPress: PropTypes.number,
    rowGetter: PropTypes.func.isRequired,
    rowsCount: PropTypes.func.isRequired,
    enableCellSelect: PropTypes.bool.isRequired,
    onCheckCellIsEditable: PropTypes.func,
    onCellCopyPaste: PropTypes.func,
    onGridRowsUpdated: PropTypes.func.isRequired,
    cellNavigationMode: PropTypes.oneOf(['none', 'loopOverRow', 'changeRow']).isRequired,
    onCellsDragged: PropTypes.func,
    onDragHandleDoubleClick: PropTypes.func,
    eventBus: PropTypes.object.isRequired
  };

  state = {
    selectedPosition: {
      idx: -1,
      rowIdx: -1
    },
    copiedPosition: null,
    draggedPosition: null,
    lockedPosition: null,
    isEditorEnabled: false,
    firstEditorKeyPress: null
  };

  componentDidUpdate(prevProps, prevState) {
    const { selectedPosition, isEditorEnabled } = this.state;
    const isSelectedPositionChanged = selectedPosition !== prevState.selectedPosition && selectedPosition.rowIdx !== -1 && selectedPosition.idx !== -1;
    const isEditorClosed = isEditorEnabled !== prevState.isEditorEnabled && !isEditorEnabled;
    if (isSelectedPositionChanged || isEditorClosed) {
      this.focus();
    }
  }

  componentDidMount() {
    this.unsubscribeSelectCell = this.props.eventBus.subscribe(EventTypes.selectCell, ({ rowIdx, idx }) => {
      this.setState({
        selectedPosition: { rowIdx, idx }
      });
    });

    this.unsubscribeDragEnter = this.props.eventBus.subscribe(EventTypes.dragEnter, ({ overRowIdx }) => {
      this.setState(({ draggedPosition }) => ({
        draggedPosition: { ...draggedPosition, overRowIdx }
      }));
    });
  }

  componentWillUnmount() {
    this.unsubscribeSelectCell();
    this.unsubscribeDragEnter();
  }

  onKeyDown = e => {
    e.preventDefault();
    // TODO: cleanup
    if (isCtrlKeyHeldDown(e)) {
      this.onPressKeyWithCtrl(e);
    } else if (e.keyCode === keyCodes.Escape) {
      this.onPressEscape(e);
    } else if (e.keyCode === keyCodes.Tab) {
      this.onPressTab(e);
    } else if (this.isKeyboardNavigationEvent(e)) {
      const keyNavAction = this.getKeyNavActionFromEvent(e);
      this.moveUsingKeyboard(keyNavAction);
    } else if (isKeyPrintable(e.keyCode) || e.keyCode === keyCodes.Backspace || e.keyCode === keyCodes.Delete) {
      this.toggleCellEdit(e);
    }
  };

  isSelectedCellEditable = () => {
    const { enableCellSelect, columns, rowGetter } = this.props;
    const { selectedPosition } = this.state;
    return isSelectedCellEditable({ enableCellSelect, columns, rowGetter, selectedPosition });
  }

  toggleCellEdit = (e) => {
    if (this.isSelectedCellEditable()) {
      const { key } = e;
      this.setState(({ isEditorEnabled }) => ({
        isEditorEnabled: !isEditorEnabled,
        firstEditorKeyPress: key
      }));
    }
  };

  onPressKeyWithCtrl = ({ keyCode }) => {
    if (this.copyPasteEnabled()) {
      if (keyCode === keyCodes.c) {
        const { columns, rowGetter } = this.props;
        const { selectedPosition } = this.state;
        const value = getSelectedCellValue({ selectedPosition, columns, rowGetter });
        this.handleCopy({ value });
      } else if (keyCode === keyCodes.v) {
        this.handlePaste();
      }
    }
  };

  onPressEscape = () => {
    if (this.copyPasteEnabled()) {
      this.handleCancelCopy();
      // this.props.toggleCellEdit(false);
      // this.focus();
    }
  };

  onPressTab = (e) => {
    if (e.shiftKey === true) {
      // this.move();
    } else {
      // this.move();
    }
  };

  copyPasteEnabled = () => {
    return this.props.onCellCopyPaste !== null && this.isSelectedCellEditable();
  };

  handleCopy = ({ value }) => {
    const { rowIdx, idx } = this.state.selectedPosition;
    this.setState({
      copiedPosition: { rowIdx, idx, value }
    });
  };

  handleCancelCopy = () => {
    this.setState({ copiedPosition: null });
  };

  handlePaste = () => {
    const { columns, onCellCopyPaste, onGridRowsUpdated } = this.props;
    const { selectedPosition, copiedPosition } = this.state;
    const { rowIdx: toRow } = selectedPosition;

    if (copiedPosition == null) {
      return;
    }

    const { key: cellKey } = getSelectedColumn({ selectedPosition, columns });
    const { rowIdx: fromRow, value: textToCopy } = copiedPosition;

    if (isFunction(onCellCopyPaste)) {
      onCellCopyPaste({
        cellKey,
        rowIdx,
        fromRow,
        toRow,
        value: textToCopy
      });
    }

    onGridRowsUpdated(cellKey, toRow, toRow, { [cellKey]: textToCopy }, AppConstants.UpdateActions.COPY_PASTE, fromRow);
  };

  isKeyboardNavigationEvent(e) {
    return this.getKeyNavActionFromEvent(e) != null;
  }

  getKeyNavActionFromEvent(e) {
    const { visibleEnd, visibleStart, colVisibleEnd, colVisibleStart, onHitBottomBoundary, onHitRightBoundary, onHitLeftBoundary, onHitTopBoundary } = this.props;
    const keyNavActions = {
      ArrowDown: {
        getNext: current => ({ ...current, rowIdx: current.rowIdx + 1 }),
        isCellAtBoundary: cell => cell.rowIdx >= visibleEnd - SCROLL_CELL_BUFFER,
        onHitBoundary: onHitBottomBoundary
      },
      ArrowUp: {
        getNext: current => ({ ...current, rowIdx: current.rowIdx - 1 }),
        isCellAtBoundary: cell => cell.rowIdx !== 0 && cell.rowIdx <= visibleStart - 1,
        onHitBoundary: onHitTopBoundary
      },
      ArrowRight: {
        getNext: current => ({ ...current, idx: current.idx + 1 }),
        isCellAtBoundary: cell => cell.idx !== 0 && cell.idx >= colVisibleEnd - 1,
        onHitBoundary: onHitRightBoundary
      },
      ArrowLeft: {
        getNext: current => ({ ...current, idx: current.idx - 1 }),
        isCellAtBoundary: cell => cell.idx !== 0 && cell.idx <= colVisibleStart + 1,
        onHitBoundary: onHitLeftBoundary
      }
    };
    return keyNavActions[e.key];
  }

  moveUsingKeyboard(keyNavAction) {
    const { getNext, isCellAtBoundary, onHitBoundary } = keyNavAction;
    const currentPosition = this.state.selectedPosition;
    const nextPosition = getNext(currentPosition);
    const { changeRowOrColumn, ...next } = getNextSelectedCellPosition(this.props, nextPosition);

    if (isCellAtBoundary(next) || changeRowOrColumn) {
      onHitBoundary(next);
    }

    this.selectCell(next);
  }

  isCellWithinBounds = ({ idx, rowIdx }) => {
    const { columns, rowsCount } = this.props;
    return rowIdx >= 0 && rowIdx < rowsCount && idx >= 0 && idx < columns.length;
  };

  isGridSelected = () => {
    return this.isCellWithinBounds(this.state.selectedPosition);
  };

  focus = () => {
    if (this.node && document.activeElement !== this.node) {
      this.node.focus();
    }
  };

  selectCell = cell => {
    if (this.isCellWithinBounds(cell)) {
      this.setState({
        selectedPosition: cell
      });
    }
  };

  dragEnabled = () => {
    const { onGridRowsUpdated, onCellsDragged } = this.props;
    return this.isSelectedCellEditable() && (isFunction(onGridRowsUpdated) || isFunction(onCellsDragged));
  };

  handleDragStart = (e) => {
    const { selectedPosition: { idx, rowIdx } } = this.state;
    // To prevent dragging down/up when reordering rows.
    const isViewportDragging = e && e.target && e.target.className;
    if (idx > -1 && isViewportDragging) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({ idx, rowIdx }));
      this.setState({
        draggedPosition: { idx, rowIdx }
      });
    }
  };

  handleDragEnd = () => {
    const { columns, onCellsDragged, onGridRowsUpdated, rowGetter } = this.props;
    const { selectedPosition, draggedPosition } = this.state;
    const { rowIdx } = selectedPosition;
    const column = getSelectedColumn({ selectedPosition, columns });
    const value = getSelectedCellValue({ selectedPosition, columns, rowGetter });
    if (draggedPosition && column) {
      const cellKey = column.key;
      const fromRow = rowIdx < draggedPosition.overRowIdx ? rowIdx : draggedPosition.overRowIdx;
      const toRow = rowIdx > draggedPosition.overRowIdx ? rowIdx : draggedPosition.overRowIdx;
      if (isFunction(onCellsDragged)) {
        onCellsDragged({ cellKey, fromRow, toRow, value });
      }
      if (isFunction(onGridRowsUpdated)) {
        onGridRowsUpdated(cellKey, fromRow, toRow, { [cellKey]: value }, AppConstants.UpdateActions.CELL_DRAG);
      }
      this.setState({
        draggedPosition: null
      });
    }
  };

  onDragHandleDoubleClick = () => {
    const { onDragHandleDoubleClick, rowGetter } = this.props;
    const { selectedPosition } = this.state;
    const { idx, rowIdx } = selectedPosition;
    const rowData = getSelectedRow({ selectedPosition, rowGetter });
    onDragHandleDoubleClick({ idx, rowIdx, rowData });
  };

  onCommit = (...args) => {
    // this.setState({ isEditorEnabled: false });
    this.props.onCommit(...args);
  };

  onCommitCancel = () => {
    this.setState({ isEditorEnabled: false });
  };

  render() {
    const { rowHeight, rowGetter, columns } = this.props;
    const { isEditorEnabled, firstEditorKeyPress, selectedPosition, draggedPosition, copiedPosition } = this.state;
    const copyMaskProps = { copiedPosition, rowHeight, columns };
    const dragMaskProps = { selectedPosition, draggedPosition, rowHeight, columns };
    const selectionMaskProps = { selectedPosition, rowHeight, columns };
    const editorContainerProps = {
      firstEditorKeyPress,
      onCommit: this.onCommit,
      onCommitCancel: this.onCommitCancel,
      value: getSelectedCellValue({ selectedPosition, columns, rowGetter }),
      rowIdx: selectedPosition.rowIdx,
      RowData: getSelectedRow({ selectedPosition, rowGetter }),
      column: getSelectedColumn({ selectedPosition, columns }),
      ...getSelectedDimensions(selectionMaskProps)
    }

    return (
      <div
        ref={node => {
          this.node = node;
        }}
        tabIndex="0"
        onKeyDown={this.onKeyDown}
      >
        <CopyMask {...copyMaskProps} />
        <DragMask {...dragMaskProps} />
        {!isEditorEnabled && this.isGridSelected() && (
          <SelectionMask {...selectionMaskProps}>
            {
              this.dragEnabled(this.props) &&
              <DragHandle
                onDragStart={this.handleDragStart}
                onDragEnd={this.handleDragEnd}
                onDoubleClick={this.onDragHandleDoubleClick}
              />
            }
          </SelectionMask>
        )}
        {isEditorEnabled && <EditorContainer {...editorContainerProps} />}
      </div>
    );
  }
}

export default InteractionMasks;