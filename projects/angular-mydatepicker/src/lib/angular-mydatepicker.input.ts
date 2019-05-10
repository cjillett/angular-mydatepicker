import {Directive, Input, ComponentRef, ElementRef, ViewContainerRef, Renderer2, ChangeDetectorRef, ComponentFactoryResolver, forwardRef, EventEmitter, Output, SimpleChanges, OnChanges, HostListener, OnDestroy} from "@angular/core";
import {AbstractControl, ControlValueAccessor, NG_VALIDATORS, NG_VALUE_ACCESSOR, Validator} from "@angular/forms";

import {IMyDate, IMyOptions, IMyDateModel, IMyDateRange, IMyRangeDateSelection, IMyCalendarViewChanged, IMyInputFieldChanged, IMySelectorPosition} from "./interfaces";
import {AngularMyDatePicker} from "./angular-mydatepicker.component";
import {LocaleService, UtilService, AngularMyDatePickerConfig} from "./services";
import {CalToggle, Year, KeyCode} from "./enums";
import {KEYUP, BLUR, EMPTY_STR, DISABLED, CLICK, BODY, VALUE, PREVENT_CLOSE_TIMEOUT, OPTIONS, DEFAULT_MONTH, LOCALE, OBJECT, PX} from "./constants";

const NGX_DP_VALUE_ACCESSOR = {
  provide: NG_VALUE_ACCESSOR,
  useExisting: forwardRef(() => AngularMyDatePickerDirective),
  multi: true
};

const NGX_DP_VALIDATORS = {
  provide: NG_VALIDATORS,
  useExisting: forwardRef(() => AngularMyDatePickerDirective),
  multi: true
};

@Directive({
  selector: "[angular-mydatepicker]",
  exportAs: "angular-mydatepicker",
  providers: [UtilService, LocaleService, NGX_DP_VALUE_ACCESSOR, NGX_DP_VALIDATORS]
})
export class AngularMyDatePickerDirective implements OnChanges, OnDestroy, ControlValueAccessor, Validator {
  @Input() options: IMyOptions;
  @Input() locale: string;
  @Input() defaultMonth: string;

  @Output() dateChanged: EventEmitter<IMyDateModel> = new EventEmitter<IMyDateModel>();
  @Output() inputFieldChanged: EventEmitter<IMyInputFieldChanged> = new EventEmitter<IMyInputFieldChanged>();
  @Output() calendarViewChanged: EventEmitter<IMyCalendarViewChanged> = new EventEmitter<IMyCalendarViewChanged>();
  @Output() calendarToggle: EventEmitter<number> = new EventEmitter<number>();
  @Output() rangeDateSelection: EventEmitter<IMyRangeDateSelection> = new EventEmitter<IMyRangeDateSelection>();

  private cRef: ComponentRef<AngularMyDatePicker> = null;
  private inputText: string = "";
  private preventClose: boolean = false;
  private disabled = false;

  private opts: IMyOptions;

  onChangeCb: (_: any) => void = () => { };
  onTouchedCb: () => void = () => { };

  constructor(private localeService: LocaleService,
              private utilService: UtilService,
              private vcRef: ViewContainerRef,
              private cfr: ComponentFactoryResolver,
              private renderer: Renderer2,
              private cdr: ChangeDetectorRef,
              private elem: ElementRef,
              private config: AngularMyDatePickerConfig) {
    this.opts = Object.assign({}, config);
    this.parseOptions(config);
  }

  @HostListener(KEYUP, ["$event"]) onKeyUp(event: KeyboardEvent) {
    let keyCode: number = this.utilService.getKeyCodeFromEvent(event);
    if (this.ignoreKeyPress(keyCode)) {
      return;
    }
    else if (keyCode === KeyCode.esc) {
      this.closeSelector(CalToggle.CloseByEsc);
    }
    else {
      let valid: boolean = false;
      if (!this.opts.dateRange) {
        let date: IMyDate = this.utilService.isDateValid(this.elem.nativeElement.value, this.opts);
        valid = this.utilService.isInitializedDate(date);
      }
      else {
        let {begin, end} = this.utilService.isDateValidDateRange(this.elem.nativeElement.value, this.opts);
        valid = this.utilService.isInitializedDate(begin) && this.utilService.isInitializedDate(end);
      }
      this.emitInputFieldChanged(this.elem.nativeElement.value, valid);
    }
  }

  @HostListener(BLUR) onBlur() {
    if (this.opts.inputFieldValidation) {
      let valid: boolean = false;
      if (!this.opts.dateRange) {
        let date: IMyDate = this.utilService.isDateValid(this.elem.nativeElement.value, this.opts);
        valid = this.utilService.isInitializedDate(date);
        if (valid && this.inputText !== this.elem.nativeElement.value) {
          // Valid date
          let dateModel: IMyDateModel = this.utilService.getDateModel(date, null, this.opts.dateFormat, this.opts.monthLabels, this.opts.dateRangeDatesDelimiter);
          this.emitDateChanged(dateModel);
          this.updateModel(dateModel);
          if (this.opts.closeSelectorOnDateSelect) {
            this.closeSelector(CalToggle.CloseByDateSel);
          }
        }
      }
      else {
        let dateRange: IMyDateRange = this.utilService.isDateValidDateRange(this.elem.nativeElement.value, this.opts);
        let {begin, end} = dateRange;
        valid = this.utilService.isInitializedDate(begin) && this.utilService.isInitializedDate(end);
        if (valid && this.inputText !== this.elem.nativeElement.value) {
          // Valid date range
          let dateModel: IMyDateModel = this.utilService.getDateModel(null, dateRange, this.opts.dateFormat, this.opts.monthLabels, this.opts.dateRangeDatesDelimiter);
          this.emitDateChanged(dateModel);
          this.updateModel(dateModel);
          if (this.opts.closeSelectorOnDateSelect) {
            this.closeSelector(CalToggle.CloseByDateSel);
          }
        }
      }

      if (!valid && this.inputText !== this.elem.nativeElement.value) {
        if (this.elem.nativeElement.value === EMPTY_STR) {
          this.clearDate();
        }
        else {
          this.onChangeCb(null);
        }
      }

      this.inputText = this.elem.nativeElement.value;
    }

    this.onTouchedCb();
  }

  // wrapper with arrow function to preserve the use of 'this' word
  private onClickWrapper = (ev: MouseEvent) => { this.onClick(ev); };

  onClick(evt: MouseEvent) {
    if (this.opts.closeSelectorOnDocumentClick && !this.preventClose && evt.target && this.cRef !== null && this.elem.nativeElement !== evt.target && !this.cRef.location.nativeElement.contains(evt.target) && !this.disabled) {
      this.closeSelector(CalToggle.CloseByOutClick);
    }
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes.hasOwnProperty(LOCALE)) {
      this.setLocaleOptions();
    }

    if (changes.hasOwnProperty(DEFAULT_MONTH)) {
      let dm: any = changes[DEFAULT_MONTH].currentValue;
      if (typeof dm === OBJECT) {
        dm = dm.defMonth;
      }
      this.defaultMonth = dm;
    }

    if (changes.hasOwnProperty(OPTIONS)) {
      this.parseOptions(changes[OPTIONS].currentValue);
    }
  }

  public ngOnDestroy(): void {
    this.closeCalendar();
  }

  setLocaleOptions(): void {
    let opts: IMyOptions = this.localeService.getLocaleOptions(this.locale);
    Object.keys(opts).forEach((k) => {
      (<IMyOptions>this.opts)[k] = opts[k];
    });
  }

  public parseOptions(opts: IMyOptions): void {
    if (opts !== undefined) {
      Object.keys(opts).forEach((k) => {
        (<IMyOptions>this.opts)[k] = opts[k];
      });
    }
    if (this.opts.minYear < Year.min) {
      this.opts.minYear = Year.min;
    }
    if (this.opts.maxYear > Year.max) {
      this.opts.maxYear = Year.max;
    }
    if (this.opts.openSelectorTopOfInput) {
      this.opts.showSelectorArrow = false;
    }
  }

  public writeValue(value: any): void {
    if (this.disabled) {
      return;
    }

    if (!value) {
      this.setInputValue(EMPTY_STR);
      this.emitInputFieldChanged(EMPTY_STR, false);
    }
    else if (value.isRange === false && value.singleDate) {
      // single date
      let {date, jsDate} = value.singleDate;
      let formatted: string = this.utilService.formatDate(date ? date : this.jsDateToMyDate(jsDate), this.opts.dateFormat, this.opts.monthLabels);
      let valid: boolean = this.utilService.isInitializedDate(this.utilService.isDateValid(formatted, this.opts));
      if (valid) {
        this.setInputValue(formatted);
        this.emitInputFieldChanged(formatted, valid);
      }
    }
    else if (value.isRange === true && value.dateRange) {
      // date range
      let {beginDate, beginJsDate, endDate, endJsDate} = value.dateRange;
      if (beginJsDate && endJsDate) {
        beginDate = this.jsDateToMyDate(beginJsDate);
        endDate = this.jsDateToMyDate(endJsDate);
      }

      if (beginDate && endDate) {
        let formatted: string = this.utilService.formatDate(beginDate, this.opts.dateFormat, this.opts.monthLabels) +
          this.opts.dateRangeDatesDelimiter +
          this.utilService.formatDate(endDate, this.opts.dateFormat, this.opts.monthLabels);
        let {begin, end} = this.utilService.isDateValidDateRange(formatted, this.opts);
        let valid: boolean = this.utilService.isInitializedDate(begin) && this.utilService.isInitializedDate(end);
        if (valid) {
          this.setInputValue(formatted);
          this.emitInputFieldChanged(formatted, valid);
        }
      }
    }
  }

  public registerOnChange(fn: any): void {
    this.onChangeCb = fn;
  }

  public registerOnTouched(fn: any): void {
    this.onTouchedCb = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.renderer.setProperty(this.elem.nativeElement, DISABLED, isDisabled);

    if (isDisabled) {
      this.closeCalendar();
    }
  }

  public validate(c: AbstractControl): { [p: string]: any } {
    if (this.elem.nativeElement.value === null || this.elem.nativeElement.value === EMPTY_STR) {
      return null;
    }
    let date: IMyDate = this.utilService.isDateValid(this.elem.nativeElement.value, this.opts);
    if (!this.utilService.isInitializedDate(date)) {
      return {invalidDateFormat: true};
    }
    return null;
  }

  public openCalendar(): void {
    if (this.disabled) {
      return;
    }
    this.preventClose = true;
    this.cdr.detectChanges();
    if (this.cRef === null) {
      this.cRef = this.vcRef.createComponent(this.cfr.resolveComponentFactory(AngularMyDatePicker));
      this.appendSelector(this.cRef.location.nativeElement);
      this.cRef.instance.initialize(
        this.opts,
        this.defaultMonth,
        this.getSelectorPosition(this.elem.nativeElement),
        this.elem.nativeElement.value,
        (dm: IMyDateModel, close: boolean) => {
          this.focusToInput();
          this.emitDateChanged(dm);
          this.emitInputFieldChanged(this.utilService.getFormattedDate(dm), true);
          this.updateModel(dm);
          if (close) {
            this.closeSelector(CalToggle.CloseByDateSel);
          }
        },
        (cvc: IMyCalendarViewChanged) => {
          this.emitCalendarChanged(cvc);
        },
        (rds: IMyRangeDateSelection) => {
          this.emitRangeDateSelection(rds);
        },
        () => {
          this.closeSelector(CalToggle.CloseByEsc);
        }
      );
      this.emitCalendarToggle(CalToggle.Open);
    }
    setTimeout(() => {
      this.preventClose = false;
    }, PREVENT_CLOSE_TIMEOUT);
  }

  public closeCalendar(): void {
    this.closeSelector(CalToggle.CloseByCalBtn);
  }

  public toggleCalendar(): void {
    if (this.disabled) {
      return;
    }
    if (this.cRef === null) {
      document.addEventListener(CLICK, this.onClickWrapper);
      this.openCalendar();
    }
    else {
      document.removeEventListener(CLICK, this.onClickWrapper);
      this.closeSelector(CalToggle.CloseByCalBtn);
    }
  }

  public clearDate(): void {
    if (this.disabled) {
      return;
    }
    this.setInputValue(EMPTY_STR);
    this.emitDateChanged({
      isRange: this.opts.dateRange,
      singleDate: {
        date: this.utilService.resetDate(),
        jsDate: null,
        formatted: EMPTY_STR,
        epoc: 0
      },
      dateRange: {
        beginDate: this.utilService.resetDate(),
        beginJsDate: null,
        beginEpoc: 0,
        endDate: this.utilService.resetDate(),
        endJsDate: null,
        endEpoc: 0,
        formatted: EMPTY_STR
      }
    });
    this.onChangeCb(null);
    this.onTouchedCb();
    this.closeSelector(CalToggle.CloseByCalBtn);
  }

  public isDateValid(): boolean {
    if (this.elem.nativeElement.value !== EMPTY_STR) {
      let date: IMyDate = this.utilService.isDateValid(this.elem.nativeElement.value, this.opts);
      if (this.utilService.isInitializedDate(date)) {
        this.emitInputFieldChanged(this.elem.nativeElement.value, true);
        return true;
      }
    }
    this.emitInputFieldChanged(this.elem.nativeElement.value, false);
    return false;
  }

  private ignoreKeyPress(keyCode: number): boolean {
    return keyCode === KeyCode.leftArrow || keyCode === KeyCode.rightArrow || keyCode === KeyCode.upArrow || keyCode === KeyCode.downArrow || keyCode === KeyCode.tab || keyCode === KeyCode.shift;
  }

  private closeSelector(reason: number): void {
    if (this.cRef !== null) {
      this.vcRef.remove(this.vcRef.indexOf(this.cRef.hostView));
      this.cRef = null;
      this.emitCalendarToggle(reason);
    }
  }

  private updateModel(model: IMyDateModel): void {
    this.setInputValue(this.utilService.getFormattedDate(model));
    this.onChangeCb(model);
    this.onTouchedCb();
  }

  private setInputValue(value: string): void {
    this.inputText = value;
    this.renderer.setProperty(this.elem.nativeElement, VALUE, value);
  }

  private focusToInput(): void {
    if (this.opts.focusInputOnDateSelect) {
      setTimeout(() => {
        this.elem.nativeElement.focus();
      });
    }
  }

  private emitDateChanged(dateModel: IMyDateModel): void {
    this.dateChanged.emit(dateModel);
  }

  private emitInputFieldChanged(value: string, valid: boolean): void {
    this.inputFieldChanged.emit({value: value, dateFormat: this.opts.dateFormat, valid: valid});
  }

  private emitCalendarChanged(cvc: IMyCalendarViewChanged) {
    this.calendarViewChanged.emit(cvc);
  }

  private emitRangeDateSelection(rds: IMyRangeDateSelection) {
    this.rangeDateSelection.emit(rds);
  }

  private emitCalendarToggle(reason: number): void {
    this.calendarToggle.emit(reason);
  }

  private jsDateToMyDate(date: Date): IMyDate {
    return {year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate()};
  }

  private appendSelector(elem: any): void {
    if (this.opts.appendSelectorToBody) {
      document.querySelector(BODY).appendChild(elem);
    }
  }

  private getSelectorPosition(elem: any): IMySelectorPosition {
    let top: number = 0;
    let left: number = 0;

    if (this.opts.appendSelectorToBody) {
      let b: any = document.body.getBoundingClientRect();
      let e: any = elem.getBoundingClientRect();
      top = e.top - b.top;
      left = e.left - b.left;
    }

    if (this.opts.openSelectorTopOfInput) {
      top = top - this.getSelectorDimension(this.opts.selectorHeight) - 2;
    }
    else {
      top = top + elem.offsetHeight + (this.opts.showSelectorArrow ? 12 : 2);
    }

    if (this.opts.alignSelectorRight) {
      left = left + elem.offsetWidth - this.getSelectorDimension(this.opts.selectorWidth);
    }
    return {top: top + PX, left: left + PX};
  }

  private getSelectorDimension(value: string): number {
    return Number(value.replace(PX, EMPTY_STR));
  }
}