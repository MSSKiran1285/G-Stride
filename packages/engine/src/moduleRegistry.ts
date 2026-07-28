import { Module } from './module';
import { Login } from './modules/login';
import { NavigateToApp } from './modules/navigateToApp';
import { ClickButton } from './modules/clickButton';
import { EnterHeaderField } from './modules/enterHeaderField';
import { AddLineItem } from './modules/addLineItem';
import { SaveAndCaptureDocumentNumber } from './modules/saveAndCaptureDocumentNumber';
import { AssertControlText } from './modules/assertControlText';
import { Wait } from './modules/wait';
import { QueryValidLineItemData } from './modules/queryValidLineItemData';
import { CleanupAbandonedDrafts } from './modules/cleanupAbandonedDrafts';
import { SearchGoodsReceiptByPO } from './modules/searchGoodsReceiptByPO';
import { ReceiveOpenLineItem } from './modules/receiveOpenLineItem';
import { OpenAppFromCatalog } from './modules/openAppFromCatalog';
import { SelectStorageLocation } from './modules/selectStorageLocation';
import { DismissDialogIfPresent } from './modules/dismissDialogIfPresent';
import { AssignPurchaseOrderItems } from './modules/assignPurchaseOrderItems';
import { MatchGrossAmountToPoReference } from './modules/matchGrossAmountToPoReference';
import { SimulateInvoice } from './modules/simulateInvoice';
import { CaptureDocumentNumberFromSuccessDialog } from './modules/captureDocumentNumberFromSuccessDialog';
import { ClickByText } from './modules/clickByText';
import { CaptureControlValue } from './modules/captureControlValue';
import { ClickTableCell } from './modules/clickTableCell';
import { FillTableCell } from './modules/fillTableCell';
import { CallControlMethod } from './modules/callControlMethod';
import { SelectTableRow } from './modules/selectTableRow';

const builtInModules: Module[] = [
  Login,
  NavigateToApp,
  ClickButton,
  EnterHeaderField,
  AddLineItem,
  SaveAndCaptureDocumentNumber,
  AssertControlText,
  Wait,
  QueryValidLineItemData,
  CleanupAbandonedDrafts,
  SearchGoodsReceiptByPO,
  ReceiveOpenLineItem,
  OpenAppFromCatalog,
  SelectStorageLocation,
  DismissDialogIfPresent,
  AssignPurchaseOrderItems,
  MatchGrossAmountToPoReference,
  SimulateInvoice,
  CaptureDocumentNumberFromSuccessDialog,
  ClickByText,
  CaptureControlValue,
  ClickTableCell,
  FillTableCell,
  CallControlMethod,
  SelectTableRow,
];

export class ModuleRegistry {
  private modules = new Map<string, Module>();

  constructor(modules: Module[] = builtInModules) {
    for (const m of modules) this.modules.set(m.name, m);
  }

  get(name: string): Module {
    const m = this.modules.get(name);
    if (!m) throw new Error(`Unknown module "${name}"`);
    return m;
  }

  /** Every registered module, in registration order — for UI module pickers. */
  list(): Module[] {
    return [...this.modules.values()];
  }
}
