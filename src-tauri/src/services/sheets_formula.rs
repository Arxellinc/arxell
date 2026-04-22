use crate::services::sheets_types::{CellCoord, ComputedValue, SheetState};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[cfg(feature = "ironcalc-engine")]
use ironcalc::base::{cell::CellValue, types::CellType, Model};

pub trait FormulaEngine: Send + Sync {
    fn recompute_sheet(&self, sheet: &mut SheetState) -> Result<(), FormulaError>;
    fn validate(&self, input: &str) -> Result<(), FormulaError>;
}

pub trait AiFormulaProvider: Send + Sync {
    fn generate(&self, prompt: &str, context: Option<&str>) -> Result<String, FormulaError>;
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
#[error("{message}")]
pub struct FormulaError {
    pub code: FormulaErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormulaErrorCode {
    CircularReference,
    InvalidReference,
    UnsupportedFormula,
    ParseFailure,
}

#[derive(Default)]
pub struct BackendFormulaEngine {
    ai_provider: Option<Arc<dyn AiFormulaProvider>>,
}

impl BackendFormulaEngine {
    pub fn new(ai_provider: Option<Arc<dyn AiFormulaProvider>>) -> Self {
        Self { ai_provider }
    }
}

impl FormulaEngine for BackendFormulaEngine {
    fn recompute_sheet(&self, sheet: &mut SheetState) -> Result<(), FormulaError> {
        let inputs: HashMap<CellCoord, String> = sheet
            .cells
            .iter()
            .map(|(coord, cell)| (coord.clone(), cell.input.clone()))
            .collect();
        let row_count = sheet.row_count;
        let col_count = sheet.col_count;
        let mut evaluator = Evaluator::new(&inputs, row_count, col_count, self.ai_provider.clone());
        let coords: Vec<CellCoord> = sheet.cells.keys().cloned().collect();
        for coord in coords {
            let result = evaluator.evaluate_cell(&coord);
            if let Some(cell) = sheet.cells.get_mut(&coord) {
                match result {
                    Ok(value) => {
                        cell.computed = value.into_computed();
                        cell.error = None;
                    }
                    Err(error) => {
                        cell.computed = ComputedValue::Empty;
                        cell.error = Some(error.message.clone());
                    }
                }
            }
        }
        Ok(())
    }

    fn validate(&self, input: &str) -> Result<(), FormulaError> {
        if !is_formula(input) {
            return Ok(());
        }
        let mut parser = Parser::new(tokenize(&input[1..])?);
        let _ = parser.parse_expression()?;
        parser.finish()?;
        Ok(())
    }
}

#[cfg(feature = "ironcalc-engine")]
pub struct IronCalcEngine;

#[cfg(feature = "ironcalc-engine")]
impl IronCalcEngine {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(feature = "ironcalc-engine")]
impl FormulaEngine for IronCalcEngine {
    fn recompute_sheet(&self, sheet: &mut SheetState) -> Result<(), FormulaError> {
        let mut model = Model::new_empty("sheet", "en", "UTC", "en")
            .map_err(|e| formula_error(FormulaErrorCode::ParseFailure, e))?;

        let cell_inputs: Vec<(CellCoord, String)> = sheet
            .cells
            .iter()
            .map(|(coord, cell)| (coord.clone(), cell.input.clone()))
            .collect();

        for (coord, input) in &cell_inputs {
            let row = (coord.row + 1) as i32;
            let col = (coord.col + 1) as i32;
            let _ = model.set_user_input(0, row, col, input.clone());
        }

        model.evaluate();

        for (coord, _) in &cell_inputs {
            let row = (coord.row + 1) as i32;
            let col = (coord.col + 1) as i32;

            if let Some(cell) = sheet.cells.get_mut(coord) {
                match model.get_cell_type(0, row, col) {
                    Ok(CellType::ErrorValue) => {
                        let error_msg = model
                            .get_formatted_cell_value(0, row, col)
                            .unwrap_or_else(|_| "#ERROR!".to_string());
                        cell.computed = ComputedValue::Empty;
                        cell.error = Some(error_msg);
                    }
                    Ok(_) => match model.get_cell_value_by_index(0, row, col) {
                        Ok(value) => {
                            cell.computed = match value {
                                CellValue::Number(n) => ComputedValue::Number(n),
                                CellValue::Boolean(b) => ComputedValue::Boolean(b),
                                CellValue::String(s) => ComputedValue::Text(s),
                                CellValue::None => ComputedValue::Empty,
                            };
                            cell.error = None;
                        }
                        Err(e) => {
                            cell.computed = ComputedValue::Empty;
                            cell.error = Some(e);
                        }
                    },
                    Err(e) => {
                        cell.computed = ComputedValue::Empty;
                        cell.error = Some(e);
                    }
                }
            }
        }

        Ok(())
    }

    fn validate(&self, input: &str) -> Result<(), FormulaError> {
        if !input.starts_with('=') {
            return Ok(());
        }
        let mut model = Model::new_empty("validate", "en", "UTC", "en")
            .map_err(|e| formula_error(FormulaErrorCode::ParseFailure, e))?;
        model
            .set_user_input(0, 1, 1, input.to_string())
            .map_err(|e| formula_error(FormulaErrorCode::ParseFailure, e))?;
        Ok(())
    }
}

pub fn create_engine(ai_provider: Option<Arc<dyn AiFormulaProvider>>) -> Box<dyn FormulaEngine> {
    #[cfg(feature = "ironcalc-engine")]
    {
        Box::new(IronCalcEngine::new())
    }
    #[cfg(not(feature = "ironcalc-engine"))]
    {
        Box::new(BackendFormulaEngine::new(ai_provider))
    }
}

#[derive(Clone, Debug, PartialEq)]
enum ValueOrRange {
    Scalar(ScalarValue),
    Range(Vec<ScalarValue>),
}

#[derive(Clone, Debug, PartialEq)]
enum ScalarValue {
    Empty,
    Text(String),
    Number(f64),
    Boolean(bool),
}

impl ScalarValue {
    fn into_computed(self) -> ComputedValue {
        match self {
            Self::Empty => ComputedValue::Empty,
            Self::Text(value) => ComputedValue::Text(value),
            Self::Number(value) => ComputedValue::Number(value),
            Self::Boolean(value) => ComputedValue::Boolean(value),
        }
    }
}

struct Evaluator<'a> {
    inputs: &'a HashMap<CellCoord, String>,
    row_count: usize,
    col_count: usize,
    memo: HashMap<CellCoord, Result<ScalarValue, FormulaError>>,
    visiting: Vec<CellCoord>,
    ai_provider: Option<Arc<dyn AiFormulaProvider>>,
}

impl<'a> Evaluator<'a> {
    fn new(
        inputs: &'a HashMap<CellCoord, String>,
        row_count: usize,
        col_count: usize,
        ai_provider: Option<Arc<dyn AiFormulaProvider>>,
    ) -> Self {
        Self {
            inputs,
            row_count,
            col_count,
            memo: HashMap::new(),
            visiting: Vec::new(),
            ai_provider,
        }
    }

    fn evaluate_cell(&mut self, coord: &CellCoord) -> Result<ScalarValue, FormulaError> {
        if let Some(cached) = self.memo.get(coord) {
            return cached.clone();
        }
        if self.visiting.contains(coord) {
            return Err(formula_error(
                FormulaErrorCode::CircularReference,
                format!("circular reference involving {}", coord_label(coord)),
            ));
        }
        self.visiting.push(coord.clone());
        let result = self.evaluate_input(self.inputs.get(coord).map(String::as_str).unwrap_or(""));
        self.visiting.pop();
        self.memo.insert(coord.clone(), result.clone());
        result
    }

    fn evaluate_input(&mut self, input: &str) -> Result<ScalarValue, FormulaError> {
        if !is_formula(input) {
            return Ok(parse_literal(input));
        }
        let mut parser = Parser::new(tokenize(&input[1..])?);
        let expr = parser.parse_expression()?;
        parser.finish()?;
        match self.eval_expr(&expr)? {
            ValueOrRange::Scalar(value) => Ok(value),
            ValueOrRange::Range(values) => {
                if values.len() == 1 {
                    Ok(values.into_iter().next().unwrap_or(ScalarValue::Empty))
                } else {
                    Err(formula_error(
                        FormulaErrorCode::UnsupportedFormula,
                        "range expressions must be used inside a function".to_string(),
                    ))
                }
            }
        }
    }

    fn eval_expr(&mut self, expr: &Expr) -> Result<ValueOrRange, FormulaError> {
        match expr {
            Expr::Number(value) => Ok(ValueOrRange::Scalar(ScalarValue::Number(*value))),
            Expr::Boolean(value) => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(*value))),
            Expr::Text(value) => Ok(ValueOrRange::Scalar(ScalarValue::Text(value.clone()))),
            Expr::Reference(coord) => Ok(ValueOrRange::Scalar(self.resolve_reference(coord)?)),
            Expr::Range(start, end) => Ok(ValueOrRange::Range(self.resolve_range(start, end)?)),
            Expr::Unary { op, expr } => {
                let scalar = Self::expect_scalar(self.eval_expr(expr)?)?;
                let number = coerce_number(&scalar)?;
                match op {
                    UnaryOp::Plus => Ok(ValueOrRange::Scalar(ScalarValue::Number(number))),
                    UnaryOp::Minus => Ok(ValueOrRange::Scalar(ScalarValue::Number(-number))),
                }
            }
            Expr::Binary { left, op, right } => {
                let left = Self::expect_scalar(self.eval_expr(left)?)?;
                let right = Self::expect_scalar(self.eval_expr(right)?)?;
                Ok(ValueOrRange::Scalar(eval_binary(op, &left, &right)?))
            }
            Expr::Function { name, args } => self.eval_function(name.as_str(), args),
        }
    }

    fn resolve_reference(&mut self, coord: &CellCoord) -> Result<ScalarValue, FormulaError> {
        if coord.row >= self.row_count || coord.col >= self.col_count {
            return Err(formula_error(
                FormulaErrorCode::InvalidReference,
                format!("invalid reference {}", coord_label(coord)),
            ));
        }
        if self.inputs.contains_key(coord) {
            self.evaluate_cell(coord)
        } else {
            Ok(ScalarValue::Empty)
        }
    }

    fn resolve_range(
        &mut self,
        start: &CellCoord,
        end: &CellCoord,
    ) -> Result<Vec<ScalarValue>, FormulaError> {
        if start.row >= self.row_count
            || start.col >= self.col_count
            || end.row >= self.row_count
            || end.col >= self.col_count
        {
            return Err(formula_error(
                FormulaErrorCode::InvalidReference,
                format!(
                    "invalid reference range {}:{}",
                    coord_label(start),
                    coord_label(end)
                ),
            ));
        }
        let min_row = start.row.min(end.row);
        let max_row = start.row.max(end.row);
        let min_col = start.col.min(end.col);
        let max_col = start.col.max(end.col);
        let mut values = Vec::new();
        for row in min_row..=max_row {
            for col in min_col..=max_col {
                values.push(self.resolve_reference(&CellCoord { row, col })?);
            }
        }
        Ok(values)
    }

    fn expect_scalar(value: ValueOrRange) -> Result<ScalarValue, FormulaError> {
        match value {
            ValueOrRange::Scalar(value) => Ok(value),
            ValueOrRange::Range(values) => {
                if values.len() == 1 {
                    Ok(values.into_iter().next().unwrap_or(ScalarValue::Empty))
                } else {
                    Err(formula_error(
                        FormulaErrorCode::UnsupportedFormula,
                        "range value cannot be used directly in this expression".to_string(),
                    ))
                }
            }
        }
    }

    fn eval_function(&mut self, name: &str, args: &[Expr]) -> Result<ValueOrRange, FormulaError> {
        let upper = name.to_ascii_uppercase();
        match upper.as_str() {
            "SUM" => Ok(ValueOrRange::Scalar(ScalarValue::Number(sum_values(
                &self.collect_function_values(args)?,
            )?))),
            "AVERAGE" => Ok(ValueOrRange::Scalar(ScalarValue::Number(average_values(
                &self.collect_function_values(args)?,
            )?))),
            "MIN" => Ok(ValueOrRange::Scalar(ScalarValue::Number(min_values(
                &self.collect_function_values(args)?,
            )?))),
            "MAX" => Ok(ValueOrRange::Scalar(ScalarValue::Number(max_values(
                &self.collect_function_values(args)?,
            )?))),
            "COUNT" => Ok(ValueOrRange::Scalar(ScalarValue::Number(count_values(
                &self.collect_function_values(args)?,
            )
                as f64))),
            "IF" => {
                if args.len() != 3 {
                    return Err(formula_error(
                        FormulaErrorCode::UnsupportedFormula,
                        "IF requires exactly 3 arguments".to_string(),
                    ));
                }
                let condition = Self::expect_scalar(self.eval_expr(&args[0])?)?;
                if is_truthy(&condition) {
                    self.eval_expr(&args[1])
                } else {
                    self.eval_expr(&args[2])
                }
            }
            "AND" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(and_values(
                &self.collect_function_values(args)?,
            )))),
            "OR" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(or_values(
                &self.collect_function_values(args)?,
            )))),
            "NOT" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(not_value(
                &self.collect_function_values(args)?,
            )?))),
            "IFERROR" => Ok(ValueOrRange::Scalar(self.eval_iferror(args)?)),
            "ROUND" => Ok(ValueOrRange::Scalar(ScalarValue::Number(round_function(
                &self.collect_function_values(args)?,
                RoundMode::Nearest,
            )?))),
            "ROUNDUP" => Ok(ValueOrRange::Scalar(ScalarValue::Number(round_function(
                &self.collect_function_values(args)?,
                RoundMode::Up,
            )?))),
            "ROUNDDOWN" => Ok(ValueOrRange::Scalar(ScalarValue::Number(round_function(
                &self.collect_function_values(args)?,
                RoundMode::Down,
            )?))),
            "INT" => Ok(ValueOrRange::Scalar(ScalarValue::Number(int_function(
                &self.collect_function_values(args)?,
            )?))),
            "ABS" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                single_number_function(&self.collect_function_values(args)?, f64::abs, "ABS")?,
            ))),
            "MOD" => Ok(ValueOrRange::Scalar(ScalarValue::Number(mod_function(
                &self.collect_function_values(args)?,
            )?))),
            "POWER" => Ok(ValueOrRange::Scalar(ScalarValue::Number(power_function(
                &self.collect_function_values(args)?,
            )?))),
            "SQRT" => Ok(ValueOrRange::Scalar(ScalarValue::Number(sqrt_function(
                &self.collect_function_values(args)?,
            )?))),
            "MEDIAN" => Ok(ValueOrRange::Scalar(ScalarValue::Number(median_values(
                &self.collect_function_values(args)?,
            )?))),
            "SUMIF" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                self.eval_sumif(args)?,
            ))),
            "COUNTIF" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                self.eval_countif(args)? as f64,
            ))),
            "AVERAGEIF" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                self.eval_averageif(args)?,
            ))),
            "CONCAT" => Ok(ValueOrRange::Scalar(ScalarValue::Text(concat_values(
                &self.collect_function_values(args)?,
            )))),
            "LEFT" => Ok(ValueOrRange::Scalar(ScalarValue::Text(left_function(
                &self.collect_function_values(args)?,
            )?))),
            "RIGHT" => Ok(ValueOrRange::Scalar(ScalarValue::Text(right_function(
                &self.collect_function_values(args)?,
            )?))),
            "MID" => Ok(ValueOrRange::Scalar(ScalarValue::Text(mid_function(
                &self.collect_function_values(args)?,
            )?))),
            "LEN" => Ok(ValueOrRange::Scalar(ScalarValue::Number(len_function(
                &self.collect_function_values(args)?,
            )?
                as f64))),
            "TRIM" => Ok(ValueOrRange::Scalar(ScalarValue::Text(trim_function(
                &self.collect_function_values(args)?,
            )?))),
            "UPPER" => Ok(ValueOrRange::Scalar(ScalarValue::Text(case_function(
                &self.collect_function_values(args)?,
                CaseMode::Upper,
            )?))),
            "LOWER" => Ok(ValueOrRange::Scalar(ScalarValue::Text(case_function(
                &self.collect_function_values(args)?,
                CaseMode::Lower,
            )?))),
            "PROPER" => Ok(ValueOrRange::Scalar(ScalarValue::Text(case_function(
                &self.collect_function_values(args)?,
                CaseMode::Proper,
            )?))),
            "FIND" => Ok(ValueOrRange::Scalar(ScalarValue::Number(find_function(
                &self.collect_function_values(args)?,
            )?
                as f64))),
            "SUBSTITUTE" => Ok(ValueOrRange::Scalar(ScalarValue::Text(
                substitute_function(&self.collect_function_values(args)?)?,
            ))),
            "REPLACE" => Ok(ValueOrRange::Scalar(ScalarValue::Text(replace_function(
                &self.collect_function_values(args)?,
            )?))),
            "TEXT" => Ok(ValueOrRange::Scalar(ScalarValue::Text(text_function(
                &self.collect_function_values(args)?,
            )?))),
            "VALUE" => Ok(ValueOrRange::Scalar(ScalarValue::Number(value_function(
                &self.collect_function_values(args)?,
            )?))),
            "DATE" => Ok(ValueOrRange::Scalar(ScalarValue::Number(date_function(
                &self.collect_function_values(args)?,
            )?))),
            "YEAR" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                date_part_function(&self.collect_function_values(args)?, DatePart::Year)? as f64,
            ))),
            "MONTH" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                date_part_function(&self.collect_function_values(args)?, DatePart::Month)? as f64,
            ))),
            "DAY" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                date_part_function(&self.collect_function_values(args)?, DatePart::Day)? as f64,
            ))),
            "HOUR" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                time_part_function(&self.collect_function_values(args)?, TimePart::Hour)? as f64,
            ))),
            "MINUTE" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                time_part_function(&self.collect_function_values(args)?, TimePart::Minute)? as f64,
            ))),
            "SECOND" => Ok(ValueOrRange::Scalar(ScalarValue::Number(
                time_part_function(&self.collect_function_values(args)?, TimePart::Second)? as f64,
            ))),
            "TODAY" => Ok(ValueOrRange::Scalar(ScalarValue::Number(today_serial(
                args,
            )?))),
            "NOW" => Ok(ValueOrRange::Scalar(ScalarValue::Number(now_serial(args)?))),
            "ISBLANK" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(
                isblank_function(&self.collect_function_values(args)?)?,
            ))),
            "ISNUMBER" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(istype_function(
                &self.collect_function_values(args)?,
                TypeCheck::Number,
            )?))),
            "ISTEXT" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(istype_function(
                &self.collect_function_values(args)?,
                TypeCheck::Text,
            )?))),
            "ISERROR" => Ok(ValueOrRange::Scalar(ScalarValue::Boolean(
                self.eval_iserror(args)?,
            ))),
            "AI" => Ok(ValueOrRange::Scalar(ScalarValue::Text(self.eval_ai(args)?))),
            _ => Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                format!("unsupported formula function {upper}"),
            )),
        }
    }

    fn eval_iferror(&mut self, args: &[Expr]) -> Result<ScalarValue, FormulaError> {
        if args.is_empty() || args.len() > 2 {
            return Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                "IFERROR requires 1 or 2 arguments".to_string(),
            ));
        }
        match self.eval_expr(&args[0]) {
            Ok(value) => Self::expect_scalar(value),
            Err(_) => {
                if args.len() == 2 {
                    Self::expect_scalar(self.eval_expr(&args[1])?)
                } else {
                    Ok(ScalarValue::Empty)
                }
            }
        }
    }

    fn eval_iserror(&mut self, args: &[Expr]) -> Result<bool, FormulaError> {
        if args.len() != 1 {
            return Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                "ISERROR requires exactly 1 argument".to_string(),
            ));
        }
        Ok(self.eval_expr(&args[0]).is_err())
    }

    fn eval_ai(&mut self, args: &[Expr]) -> Result<String, FormulaError> {
        if args.is_empty() || args.len() > 2 {
            return Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                "AI requires 1 or 2 arguments".to_string(),
            ));
        }
        let provider = self.ai_provider.clone().ok_or_else(|| {
            formula_error(
                FormulaErrorCode::UnsupportedFormula,
                "AI is not configured for this sheet".to_string(),
            )
        })?;
        let prompt = text_value(&Self::expect_scalar(self.eval_expr(&args[0])?)?);
        let context = if args.len() == 2 {
            let values = self.collect_range_like_values(&args[1])?;
            Some(format_ai_context(&values))
        } else {
            None
        };
        provider.generate(&prompt, context.as_deref())
    }

    fn eval_sumif(&mut self, args: &[Expr]) -> Result<f64, FormulaError> {
        let matches = self.collect_if_matches(args, "SUMIF", true)?;
        Ok(matches
            .iter()
            .map(|(_, value)| coerce_number(value))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .sum())
    }

    fn eval_countif(&mut self, args: &[Expr]) -> Result<usize, FormulaError> {
        let matches = self.collect_if_matches(args, "COUNTIF", false)?;
        Ok(matches.len())
    }

    fn eval_averageif(&mut self, args: &[Expr]) -> Result<f64, FormulaError> {
        let matches = self.collect_if_matches(args, "AVERAGEIF", true)?;
        if matches.is_empty() {
            return Ok(0.0);
        }
        let nums = matches
            .iter()
            .map(|(_, value)| coerce_number(value))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(nums.iter().sum::<f64>() / nums.len() as f64)
    }

    fn collect_if_matches(
        &mut self,
        args: &[Expr],
        name: &str,
        allow_target_range: bool,
    ) -> Result<Vec<(ScalarValue, ScalarValue)>, FormulaError> {
        let (criteria_range_expr, criteria_expr, value_range_expr) = match (name, args.len()) {
            ("COUNTIF", 2) => (&args[0], &args[1], None),
            ("SUMIF", 2) => (&args[0], &args[1], None),
            ("SUMIF", 3) => (&args[0], &args[1], Some(&args[2])),
            ("AVERAGEIF", 2) => (&args[0], &args[1], None),
            ("AVERAGEIF", 3) => (&args[0], &args[1], Some(&args[2])),
            _ => {
                return Err(formula_error(
                    FormulaErrorCode::UnsupportedFormula,
                    format!("{name} has invalid arguments"),
                ))
            }
        };

        let criteria_values = self.collect_range_like_values(criteria_range_expr)?;
        let target_values = if let Some(expr) = value_range_expr {
            self.collect_range_like_values(expr)?
        } else if allow_target_range {
            criteria_values.clone()
        } else {
            criteria_values.clone()
        };
        if criteria_values.len() != target_values.len() {
            return Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                format!("{name} ranges must be the same size"),
            ));
        }
        let criterion = Self::expect_scalar(self.eval_expr(criteria_expr)?)?;
        let matcher = build_criteria_matcher(&criterion)?;
        Ok(criteria_values
            .into_iter()
            .zip(target_values)
            .filter(|(criteria_value, _)| matcher(criteria_value))
            .collect())
    }

    fn collect_range_like_values(&mut self, expr: &Expr) -> Result<Vec<ScalarValue>, FormulaError> {
        match self.eval_expr(expr)? {
            ValueOrRange::Scalar(value) => Ok(vec![value]),
            ValueOrRange::Range(values) => Ok(values),
        }
    }

    fn collect_function_values(&mut self, args: &[Expr]) -> Result<Vec<ScalarValue>, FormulaError> {
        let mut values = Vec::new();
        for arg in args {
            match self.eval_expr(arg)? {
                ValueOrRange::Scalar(value) => values.push(value),
                ValueOrRange::Range(range) => values.extend(range),
            }
        }
        Ok(values)
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Expr {
    Number(f64),
    Boolean(bool),
    Text(String),
    Reference(CellCoord),
    Range(CellCoord, CellCoord),
    Unary {
        op: UnaryOp,
        expr: Box<Expr>,
    },
    Binary {
        left: Box<Expr>,
        op: BinaryOp,
        right: Box<Expr>,
    },
    Function {
        name: String,
        args: Vec<Expr>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum UnaryOp {
    Plus,
    Minus,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum BinaryOp {
    Add,
    Concat,
    Sub,
    Mul,
    Div,
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Ident(String),
    Str(String),
    LParen,
    RParen,
    Comma,
    Colon,
    Plus,
    Amp,
    Minus,
    Star,
    Slash,
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
}

struct Parser {
    tokens: Vec<Token>,
    index: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, index: 0 }
    }

    fn finish(&self) -> Result<(), FormulaError> {
        if self.index == self.tokens.len() {
            Ok(())
        } else {
            Err(formula_error(
                FormulaErrorCode::ParseFailure,
                "unexpected trailing tokens in formula".to_string(),
            ))
        }
    }

    fn parse_expression(&mut self) -> Result<Expr, FormulaError> {
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<Expr, FormulaError> {
        let mut expr = self.parse_additive()?;
        while let Some(op) = self.match_comparison() {
            let right = self.parse_additive()?;
            expr = Expr::Binary {
                left: Box::new(expr),
                op,
                right: Box::new(right),
            };
        }
        Ok(expr)
    }

    fn parse_additive(&mut self) -> Result<Expr, FormulaError> {
        let mut expr = self.parse_multiplicative()?;
        loop {
            let op = if self.consume(&Token::Plus) {
                Some(BinaryOp::Add)
            } else if self.consume(&Token::Amp) {
                Some(BinaryOp::Concat)
            } else if self.consume(&Token::Minus) {
                Some(BinaryOp::Sub)
            } else {
                None
            };
            let Some(op) = op else { break };
            let right = self.parse_multiplicative()?;
            expr = Expr::Binary {
                left: Box::new(expr),
                op,
                right: Box::new(right),
            };
        }
        Ok(expr)
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, FormulaError> {
        let mut expr = self.parse_unary()?;
        loop {
            let op = if self.consume(&Token::Star) {
                Some(BinaryOp::Mul)
            } else if self.consume(&Token::Slash) {
                Some(BinaryOp::Div)
            } else {
                None
            };
            let Some(op) = op else { break };
            let right = self.parse_unary()?;
            expr = Expr::Binary {
                left: Box::new(expr),
                op,
                right: Box::new(right),
            };
        }
        Ok(expr)
    }

    fn parse_unary(&mut self) -> Result<Expr, FormulaError> {
        if self.consume(&Token::Plus) {
            return Ok(Expr::Unary {
                op: UnaryOp::Plus,
                expr: Box::new(self.parse_unary()?),
            });
        }
        if self.consume(&Token::Minus) {
            return Ok(Expr::Unary {
                op: UnaryOp::Minus,
                expr: Box::new(self.parse_unary()?),
            });
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, FormulaError> {
        if let Some(Token::Number(value)) = self.peek().cloned() {
            self.index += 1;
            return Ok(Expr::Number(value));
        }
        if let Some(Token::Str(value)) = self.peek().cloned() {
            self.index += 1;
            return Ok(Expr::Text(value));
        }
        if self.consume(&Token::LParen) {
            let expr = self.parse_expression()?;
            self.expect(Token::RParen)?;
            return Ok(expr);
        }
        let Some(Token::Ident(ident)) = self.peek().cloned() else {
            return Err(formula_error(
                FormulaErrorCode::ParseFailure,
                "#error".to_string(),
            ));
        };
        self.index += 1;
        if self.consume(&Token::LParen) {
            let mut args = Vec::new();
            if !self.check(&Token::RParen) {
                loop {
                    args.push(self.parse_expression()?);
                    if !self.consume(&Token::Comma) {
                        break;
                    }
                }
            }
            self.expect(Token::RParen)?;
            return Ok(Expr::Function { name: ident, args });
        }
        if ident.eq_ignore_ascii_case("TRUE") {
            return Ok(Expr::Boolean(true));
        }
        if ident.eq_ignore_ascii_case("FALSE") {
            return Ok(Expr::Boolean(false));
        }
        let coord = parse_cell_coord(&ident).ok_or_else(|| {
            formula_error(
                FormulaErrorCode::UnsupportedFormula,
                format!("unsupported identifier {ident}"),
            )
        })?;
        if self.consume(&Token::Colon) {
            let Some(Token::Ident(end_ident)) = self.peek().cloned() else {
                return Err(formula_error(
                    FormulaErrorCode::ParseFailure,
                    "range must end with a cell reference".to_string(),
                ));
            };
            self.index += 1;
            let end = parse_cell_coord(&end_ident).ok_or_else(|| {
                formula_error(
                    FormulaErrorCode::ParseFailure,
                    "range must end with a valid cell reference".to_string(),
                )
            })?;
            return Ok(Expr::Range(coord, end));
        }
        Ok(Expr::Reference(coord))
    }

    fn match_comparison(&mut self) -> Option<BinaryOp> {
        if self.consume(&Token::Eq) {
            Some(BinaryOp::Eq)
        } else if self.consume(&Token::Ne) {
            Some(BinaryOp::Ne)
        } else if self.consume(&Token::Lte) {
            Some(BinaryOp::Lte)
        } else if self.consume(&Token::Lt) {
            Some(BinaryOp::Lt)
        } else if self.consume(&Token::Gte) {
            Some(BinaryOp::Gte)
        } else if self.consume(&Token::Gt) {
            Some(BinaryOp::Gt)
        } else {
            None
        }
    }

    fn consume(&mut self, token: &Token) -> bool {
        if self.check(token) {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn check(&self, token: &Token) -> bool {
        self.peek().is_some_and(|next| same_token_kind(next, token))
    }

    fn expect(&mut self, token: Token) -> Result<(), FormulaError> {
        if self.consume(&token) {
            Ok(())
        } else {
            Err(formula_error(
                FormulaErrorCode::ParseFailure,
                "unexpected token in formula".to_string(),
            ))
        }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }
}

fn same_token_kind(left: &Token, right: &Token) -> bool {
    std::mem::discriminant(left) == std::mem::discriminant(right)
}

fn tokenize(input: &str) -> Result<Vec<Token>, FormulaError> {
    let chars: Vec<char> = input.chars().collect();
    let mut index = 0;
    let mut tokens = Vec::new();
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
            continue;
        }
        match ch {
            '(' => {
                tokens.push(Token::LParen);
                index += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                index += 1;
            }
            ',' => {
                tokens.push(Token::Comma);
                index += 1;
            }
            ':' => {
                tokens.push(Token::Colon);
                index += 1;
            }
            '+' => {
                tokens.push(Token::Plus);
                index += 1;
            }
            '&' => {
                tokens.push(Token::Amp);
                index += 1;
            }
            '-' => {
                tokens.push(Token::Minus);
                index += 1;
            }
            '*' => {
                tokens.push(Token::Star);
                index += 1;
            }
            '/' => {
                tokens.push(Token::Slash);
                index += 1;
            }
            '=' => {
                if index + 1 < chars.len() && chars[index + 1] == '=' {
                    index += 1;
                }
                tokens.push(Token::Eq);
                index += 1;
            }
            '!' => {
                if index + 1 < chars.len() && chars[index + 1] == '=' {
                    tokens.push(Token::Ne);
                    index += 2;
                } else {
                    return Err(formula_error(
                        FormulaErrorCode::ParseFailure,
                        "unexpected ! in formula".to_string(),
                    ));
                }
            }
            '<' => {
                if index + 1 < chars.len() && chars[index + 1] == '=' {
                    tokens.push(Token::Lte);
                    index += 2;
                } else if index + 1 < chars.len() && chars[index + 1] == '>' {
                    tokens.push(Token::Ne);
                    index += 2;
                } else {
                    tokens.push(Token::Lt);
                    index += 1;
                }
            }
            '>' => {
                if index + 1 < chars.len() && chars[index + 1] == '=' {
                    tokens.push(Token::Gte);
                    index += 2;
                } else {
                    tokens.push(Token::Gt);
                    index += 1;
                }
            }
            c if c.is_ascii_digit() || c == '.' => {
                let start = index;
                index += 1;
                while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == '.')
                {
                    index += 1;
                }
                let slice: String = chars[start..index].iter().collect();
                let value = slice.parse::<f64>().map_err(|_| {
                    formula_error(
                        FormulaErrorCode::ParseFailure,
                        format!("invalid number literal {slice}"),
                    )
                })?;
                tokens.push(Token::Number(value));
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let start = index;
                index += 1;
                while index < chars.len()
                    && (chars[index].is_ascii_alphanumeric() || chars[index] == '_')
                {
                    index += 1;
                }
                let slice: String = chars[start..index].iter().collect();
                tokens.push(Token::Ident(slice));
            }
            '"' => {
                index += 1;
                let mut value = String::new();
                let mut terminated = false;
                while index < chars.len() {
                    if chars[index] == '"' {
                        if index + 1 < chars.len() && chars[index + 1] == '"' {
                            value.push('"');
                            index += 2;
                            continue;
                        }
                        index += 1;
                        terminated = true;
                        break;
                    }
                    value.push(chars[index]);
                    index += 1;
                }
                if !terminated {
                    return Err(formula_error(
                        FormulaErrorCode::ParseFailure,
                        "unterminated string literal".to_string(),
                    ));
                }
                tokens.push(Token::Str(value));
            }
            _ => {
                return Err(formula_error(
                    FormulaErrorCode::ParseFailure,
                    format!("unexpected character {ch}"),
                ))
            }
        }
    }
    Ok(tokens)
}

fn parse_literal(input: &str) -> ScalarValue {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        ScalarValue::Empty
    } else if trimmed.eq_ignore_ascii_case("true") {
        ScalarValue::Boolean(true)
    } else if trimmed.eq_ignore_ascii_case("false") {
        ScalarValue::Boolean(false)
    } else if let Ok(value) = trimmed.parse::<f64>() {
        ScalarValue::Number(value)
    } else {
        ScalarValue::Text(input.to_string())
    }
}

fn eval_binary(
    op: &BinaryOp,
    left: &ScalarValue,
    right: &ScalarValue,
) -> Result<ScalarValue, FormulaError> {
    match op {
        BinaryOp::Add => Ok(ScalarValue::Number(
            coerce_number(left)? + coerce_number(right)?,
        )),
        BinaryOp::Concat => Ok(ScalarValue::Text(format!(
            "{}{}",
            text_value(left),
            text_value(right)
        ))),
        BinaryOp::Sub => Ok(ScalarValue::Number(
            coerce_number(left)? - coerce_number(right)?,
        )),
        BinaryOp::Mul => Ok(ScalarValue::Number(
            coerce_number(left)? * coerce_number(right)?,
        )),
        BinaryOp::Div => {
            let divisor = coerce_number(right)?;
            if divisor == 0.0 {
                return Err(formula_error(
                    FormulaErrorCode::UnsupportedFormula,
                    "division by zero".to_string(),
                ));
            }
            Ok(ScalarValue::Number(coerce_number(left)? / divisor))
        }
        BinaryOp::Eq => Ok(ScalarValue::Boolean(
            compare_values(left, right) == std::cmp::Ordering::Equal,
        )),
        BinaryOp::Ne => Ok(ScalarValue::Boolean(
            compare_values(left, right) != std::cmp::Ordering::Equal,
        )),
        BinaryOp::Lt => Ok(ScalarValue::Boolean(
            compare_values(left, right) == std::cmp::Ordering::Less,
        )),
        BinaryOp::Lte => Ok(ScalarValue::Boolean(matches!(
            compare_values(left, right),
            std::cmp::Ordering::Less | std::cmp::Ordering::Equal
        ))),
        BinaryOp::Gt => Ok(ScalarValue::Boolean(
            compare_values(left, right) == std::cmp::Ordering::Greater,
        )),
        BinaryOp::Gte => Ok(ScalarValue::Boolean(matches!(
            compare_values(left, right),
            std::cmp::Ordering::Greater | std::cmp::Ordering::Equal
        ))),
    }
}

fn compare_values(left: &ScalarValue, right: &ScalarValue) -> std::cmp::Ordering {
    match (left, right) {
        (ScalarValue::Number(a), ScalarValue::Number(b)) => {
            a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
        }
        (ScalarValue::Boolean(a), ScalarValue::Boolean(b)) => a.cmp(b),
        _ => scalar_to_string(left).cmp(&scalar_to_string(right)),
    }
}

fn scalar_to_string(value: &ScalarValue) -> String {
    match value {
        ScalarValue::Empty => String::new(),
        ScalarValue::Text(value) => value.clone(),
        ScalarValue::Number(value) => value.to_string(),
        ScalarValue::Boolean(value) => value.to_string(),
    }
}

fn coerce_number(value: &ScalarValue) -> Result<f64, FormulaError> {
    match value {
        ScalarValue::Empty => Ok(0.0),
        ScalarValue::Number(value) => Ok(*value),
        ScalarValue::Boolean(value) => Ok(if *value { 1.0 } else { 0.0 }),
        ScalarValue::Text(text) => text.trim().parse::<f64>().map_err(|_| {
            formula_error(
                FormulaErrorCode::UnsupportedFormula,
                format!("non-numeric value '{text}'"),
            )
        }),
    }
}

fn is_truthy(value: &ScalarValue) -> bool {
    match value {
        ScalarValue::Empty => false,
        ScalarValue::Boolean(value) => *value,
        ScalarValue::Number(value) => *value != 0.0,
        ScalarValue::Text(text) => !text.is_empty(),
    }
}

fn sum_values(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    let mut total = 0.0;
    for value in values {
        total += coerce_number(value)?;
    }
    Ok(total)
}

fn average_values(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.is_empty() {
        return Ok(0.0);
    }
    Ok(sum_values(values)? / values.len() as f64)
}

fn min_values(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    let mut iter = values.iter();
    let Some(first) = iter.next() else {
        return Ok(0.0);
    };
    let mut min = coerce_number(first)?;
    for value in iter {
        min = min.min(coerce_number(value)?);
    }
    Ok(min)
}

fn max_values(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    let mut iter = values.iter();
    let Some(first) = iter.next() else {
        return Ok(0.0);
    };
    let mut max = coerce_number(first)?;
    for value in iter {
        max = max.max(coerce_number(value)?);
    }
    Ok(max)
}

fn count_values(values: &[ScalarValue]) -> usize {
    values
        .iter()
        .filter(|value| matches!(value, ScalarValue::Number(_)))
        .count()
}

#[derive(Clone, Copy)]
enum RoundMode {
    Nearest,
    Up,
    Down,
}

#[derive(Clone, Copy)]
enum CaseMode {
    Upper,
    Lower,
    Proper,
}

#[derive(Clone, Copy)]
enum DatePart {
    Year,
    Month,
    Day,
}

#[derive(Clone, Copy)]
enum TimePart {
    Hour,
    Minute,
    Second,
}

#[derive(Clone, Copy)]
enum TypeCheck {
    Number,
    Text,
}

fn and_values(values: &[ScalarValue]) -> bool {
    values.iter().all(is_truthy)
}

fn or_values(values: &[ScalarValue]) -> bool {
    values.iter().any(is_truthy)
}

fn not_value(values: &[ScalarValue]) -> Result<bool, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "NOT requires exactly 1 argument".to_string(),
        ));
    }
    Ok(!is_truthy(&values[0]))
}

fn single_number_function(
    values: &[ScalarValue],
    mapper: impl Fn(f64) -> f64,
    name: &str,
) -> Result<f64, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            format!("{name} requires exactly 1 argument"),
        ));
    }
    Ok(mapper(coerce_number(&values[0])?))
}

fn round_function(values: &[ScalarValue], mode: RoundMode) -> Result<f64, FormulaError> {
    if values.is_empty() || values.len() > 2 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "rounding function requires 1 or 2 arguments".to_string(),
        ));
    }
    let value = coerce_number(&values[0])?;
    let digits = if values.len() == 2 {
        coerce_number(&values[1])?.trunc() as i32
    } else {
        0
    };
    let factor = 10f64.powi(digits);
    let scaled = value * factor;
    let rounded = match mode {
        RoundMode::Nearest => scaled.round(),
        RoundMode::Up => {
            if scaled >= 0.0 {
                scaled.ceil()
            } else {
                scaled.floor()
            }
        }
        RoundMode::Down => {
            if scaled >= 0.0 {
                scaled.floor()
            } else {
                scaled.ceil()
            }
        }
    };
    Ok(rounded / factor)
}

fn int_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    single_number_function(values, f64::floor, "INT")
}

fn mod_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.len() != 2 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "MOD requires exactly 2 arguments".to_string(),
        ));
    }
    let dividend = coerce_number(&values[0])?;
    let divisor = coerce_number(&values[1])?;
    if divisor == 0.0 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "division by zero".to_string(),
        ));
    }
    Ok(dividend - divisor * (dividend / divisor).floor())
}

fn power_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.len() != 2 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "POWER requires exactly 2 arguments".to_string(),
        ));
    }
    Ok(coerce_number(&values[0])?.powf(coerce_number(&values[1])?))
}

fn sqrt_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    let value = single_number_function(values, |v| v, "SQRT")?;
    if value < 0.0 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "SQRT requires a non-negative number".to_string(),
        ));
    }
    Ok(value.sqrt())
}

fn median_values(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.is_empty() {
        return Ok(0.0);
    }
    let mut nums = values
        .iter()
        .map(coerce_number)
        .collect::<Result<Vec<_>, _>>()?;
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let mid = nums.len() / 2;
    if nums.len() % 2 == 0 {
        Ok((nums[mid - 1] + nums[mid]) / 2.0)
    } else {
        Ok(nums[mid])
    }
}

fn concat_values(values: &[ScalarValue]) -> String {
    values.iter().map(text_value).collect::<Vec<_>>().join("")
}

fn left_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    text_slice_function(values, SliceMode::Left)
}

fn right_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    text_slice_function(values, SliceMode::Right)
}

fn mid_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    if values.len() != 3 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "MID requires exactly 3 arguments".to_string(),
        ));
    }
    let text = text_value(&values[0]);
    let start = positive_int_arg(&values[1], "MID")?;
    let length = non_negative_int_arg(&values[2], "MID")?;
    Ok(text
        .chars()
        .skip(start.saturating_sub(1))
        .take(length)
        .collect())
}

fn len_function(values: &[ScalarValue]) -> Result<usize, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "LEN requires exactly 1 argument".to_string(),
        ));
    }
    Ok(text_value(&values[0]).chars().count())
}

fn trim_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "TRIM requires exactly 1 argument".to_string(),
        ));
    }
    Ok(text_value(&values[0])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" "))
}

fn case_function(values: &[ScalarValue], mode: CaseMode) -> Result<String, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "case conversion function requires exactly 1 argument".to_string(),
        ));
    }
    let text = text_value(&values[0]);
    Ok(match mode {
        CaseMode::Upper => text.to_uppercase(),
        CaseMode::Lower => text.to_lowercase(),
        CaseMode::Proper => to_proper_case(&text),
    })
}

fn find_function(values: &[ScalarValue]) -> Result<usize, FormulaError> {
    if values.len() < 2 || values.len() > 3 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "FIND requires 2 or 3 arguments".to_string(),
        ));
    }
    let needle = text_value(&values[0]);
    let haystack = text_value(&values[1]);
    let start = if values.len() == 3 {
        positive_int_arg(&values[2], "FIND")?
    } else {
        1
    };
    let slice: String = haystack.chars().skip(start.saturating_sub(1)).collect();
    let Some(pos) = slice.find(&needle) else {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "FIND could not locate the search text".to_string(),
        ));
    };
    Ok(haystack[..haystack.len() - slice.len()].chars().count() + pos + 1)
}

fn substitute_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    if values.len() < 3 || values.len() > 4 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "SUBSTITUTE requires 3 or 4 arguments".to_string(),
        ));
    }
    let text = text_value(&values[0]);
    let search = text_value(&values[1]);
    let replacement = text_value(&values[2]);
    if values.len() == 3 {
        return Ok(text.replace(&search, &replacement));
    }
    let instance = positive_int_arg(&values[3], "SUBSTITUTE")?;
    substitute_instance(&text, &search, &replacement, instance)
}

fn replace_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    if values.len() != 4 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "REPLACE requires exactly 4 arguments".to_string(),
        ));
    }
    let text = text_value(&values[0]);
    let start = positive_int_arg(&values[1], "REPLACE")?;
    let length = non_negative_int_arg(&values[2], "REPLACE")?;
    let replacement = text_value(&values[3]);
    let prefix: String = text.chars().take(start.saturating_sub(1)).collect();
    let suffix: String = text
        .chars()
        .skip(start.saturating_sub(1) + length)
        .collect();
    Ok(format!("{prefix}{replacement}{suffix}"))
}

fn text_function(values: &[ScalarValue]) -> Result<String, FormulaError> {
    if values.len() != 2 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "TEXT requires exactly 2 arguments".to_string(),
        ));
    }
    let value = coerce_number(&values[0])?;
    let pattern = text_value(&values[1]);
    format_text_value(value, &pattern)
}

fn value_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "VALUE requires exactly 1 argument".to_string(),
        ));
    }
    parse_value_string(&text_value(&values[0]))
}

fn date_function(values: &[ScalarValue]) -> Result<f64, FormulaError> {
    if values.len() != 3 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "DATE requires exactly 3 arguments".to_string(),
        ));
    }
    let year = coerce_number(&values[0])?.trunc() as i32;
    let month = coerce_number(&values[1])?.trunc() as i32;
    let day = coerce_number(&values[2])?.trunc() as i32;
    Ok(date_to_serial(normalize_date_parts(year, month, day)))
}

fn date_part_function(values: &[ScalarValue], part: DatePart) -> Result<i32, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "date part function requires exactly 1 argument".to_string(),
        ));
    }
    let dt = serial_to_datetime(coerce_number(&values[0])?)?;
    Ok(match part {
        DatePart::Year => dt.year,
        DatePart::Month => dt.month as i32,
        DatePart::Day => dt.day as i32,
    })
}

fn time_part_function(values: &[ScalarValue], part: TimePart) -> Result<i32, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "time part function requires exactly 1 argument".to_string(),
        ));
    }
    let dt = serial_to_datetime(coerce_number(&values[0])?)?;
    Ok(match part {
        TimePart::Hour => dt.hour as i32,
        TimePart::Minute => dt.minute as i32,
        TimePart::Second => dt.second as i32,
    })
}

fn today_serial(args: &[Expr]) -> Result<f64, FormulaError> {
    if !args.is_empty() {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "TODAY requires no arguments".to_string(),
        ));
    }
    Ok(now_serial(args)?.floor())
}

fn now_serial(args: &[Expr]) -> Result<f64, FormulaError> {
    if !args.is_empty() {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "NOW requires no arguments".to_string(),
        ));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| {
        formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "invalid system time".to_string(),
        )
    })?;
    let unix_days = now.as_secs_f64() / 86_400.0;
    Ok(unix_days + 25569.0)
}

fn isblank_function(values: &[ScalarValue]) -> Result<bool, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "ISBLANK requires exactly 1 argument".to_string(),
        ));
    }
    Ok(matches!(values[0], ScalarValue::Empty))
}

fn istype_function(values: &[ScalarValue], kind: TypeCheck) -> Result<bool, FormulaError> {
    if values.len() != 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "type-check function requires exactly 1 argument".to_string(),
        ));
    }
    Ok(match kind {
        TypeCheck::Number => matches!(values[0], ScalarValue::Number(_)),
        TypeCheck::Text => matches!(values[0], ScalarValue::Text(_)),
    })
}

enum SliceMode {
    Left,
    Right,
}

fn text_slice_function(values: &[ScalarValue], mode: SliceMode) -> Result<String, FormulaError> {
    if values.is_empty() || values.len() > 2 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            "text slice function requires 1 or 2 arguments".to_string(),
        ));
    }
    let text = text_value(&values[0]);
    let count = if values.len() == 2 {
        non_negative_int_arg(&values[1], "slice")?
    } else {
        1
    };
    let chars: Vec<char> = text.chars().collect();
    Ok(match mode {
        SliceMode::Left => chars.into_iter().take(count).collect(),
        SliceMode::Right => chars
            .into_iter()
            .rev()
            .take(count)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
    })
}

fn positive_int_arg(value: &ScalarValue, name: &str) -> Result<usize, FormulaError> {
    let number = coerce_number(value)?.trunc() as isize;
    if number < 1 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            format!("{name} requires a positive integer argument"),
        ));
    }
    Ok(number as usize)
}

fn non_negative_int_arg(value: &ScalarValue, name: &str) -> Result<usize, FormulaError> {
    let number = coerce_number(value)?.trunc() as isize;
    if number < 0 {
        return Err(formula_error(
            FormulaErrorCode::UnsupportedFormula,
            format!("{name} requires a non-negative integer argument"),
        ));
    }
    Ok(number as usize)
}

fn text_value(value: &ScalarValue) -> String {
    match value {
        ScalarValue::Empty => String::new(),
        ScalarValue::Text(text) => text.clone(),
        ScalarValue::Number(number) => {
            if number.fract() == 0.0 {
                format!("{}", *number as i64)
            } else {
                number.to_string()
            }
        }
        ScalarValue::Boolean(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
    }
}

fn format_ai_context(values: &[ScalarValue]) -> String {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| format!("{}: {}", index + 1, text_value(value)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn to_proper_case(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut capitalize = true;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if capitalize {
                result.extend(ch.to_uppercase());
            } else {
                result.extend(ch.to_lowercase());
            }
            capitalize = false;
        } else {
            capitalize = true;
            result.push(ch);
        }
    }
    result
}

fn substitute_instance(
    text: &str,
    search: &str,
    replacement: &str,
    instance: usize,
) -> Result<String, FormulaError> {
    if search.is_empty() {
        return Ok(text.to_string());
    }
    let mut count = 0usize;
    let mut index = 0usize;
    let mut result = String::new();
    while let Some(pos) = text[index..].find(search) {
        let absolute = index + pos;
        result.push_str(&text[index..absolute]);
        count += 1;
        if count == instance {
            result.push_str(replacement);
        } else {
            result.push_str(search);
        }
        index = absolute + search.len();
    }
    result.push_str(&text[index..]);
    Ok(result)
}

fn parse_value_string(text: &str) -> Result<f64, FormulaError> {
    let trimmed = text.trim();
    if let Ok(value) = trimmed.parse::<f64>() {
        return Ok(value);
    }
    let normalized_number = trimmed.replace(',', "");
    if normalized_number != trimmed {
        if let Ok(value) = normalized_number.parse::<f64>() {
            return Ok(value);
        }
    }
    if let Some(percent) = trimmed.strip_suffix('%') {
        let normalized_percent = percent.trim().replace(',', "");
        if let Ok(value) = normalized_percent.parse::<f64>() {
            return Ok(value / 100.0);
        }
    }
    if let Some(dt) = parse_datetime_string(trimmed) {
        return Ok(date_to_serial(dt));
    }
    if let Some((hour, minute, second)) = parse_time_string(trimmed) {
        return Ok((hour as f64 * 3600.0 + minute as f64 * 60.0 + second as f64) / 86_400.0);
    }
    Err(formula_error(
        FormulaErrorCode::UnsupportedFormula,
        format!("VALUE could not parse '{text}'"),
    ))
}

pub fn format_text_value(value: f64, pattern: &str) -> Result<String, FormulaError> {
    let normalized = pattern.trim().to_ascii_lowercase();
    if normalized == "0" {
        return Ok(format!("{}", value.round() as i64));
    }
    if normalized == "0.00" {
        return Ok(format!("{value:.2}"));
    }
    if normalized == "0.0" {
        return Ok(format!("{value:.1}"));
    }
    if normalized == "#,##0" {
        return Ok(format_grouped_number(value, 0));
    }
    if normalized == "#,##0.0" {
        return Ok(format_grouped_number(value, 1));
    }
    if normalized == "#,##0.00" {
        return Ok(format_grouped_number(value, 2));
    }
    if normalized == "0%" {
        return Ok(format!("{}%", (value * 100.0).round() as i64));
    }
    if normalized == "0.0%" {
        return Ok(format!("{:.1}%", value * 100.0));
    }
    if normalized == "0.00%" {
        return Ok(format!("{:.2}%", value * 100.0));
    }
    if normalized == "yyyy-mm-dd" {
        let dt = serial_to_datetime(value)?;
        return Ok(format!("{:04}-{:02}-{:02}", dt.year, dt.month, dt.day));
    }
    if normalized == "hh:mm:ss" {
        let dt = serial_to_datetime(value)?;
        return Ok(format!("{:02}:{:02}:{:02}", dt.hour, dt.minute, dt.second));
    }
    if normalized == "yyyy-mm-dd hh:mm:ss" {
        let dt = serial_to_datetime(value)?;
        return Ok(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second
        ));
    }
    Err(formula_error(
        FormulaErrorCode::UnsupportedFormula,
        format!("TEXT does not support format '{pattern}' yet"),
    ))
}

fn format_grouped_number(value: f64, decimals: usize) -> String {
    let negative = value.is_sign_negative();
    let abs = value.abs();
    let rendered = if decimals == 0 {
        format!("{}", abs.round() as i64)
    } else {
        format!("{abs:.decimals$}")
    };
    let (int_part, frac_part) = rendered.split_once('.').unwrap_or((&rendered, ""));
    let grouped = group_digits(int_part);
    if decimals == 0 {
        if negative {
            format!("-{grouped}")
        } else {
            grouped
        }
    } else if negative {
        format!("-{grouped}.{frac_part}")
    } else {
        format!("{grouped}.{frac_part}")
    }
}

fn group_digits(int_part: &str) -> String {
    let chars: Vec<char> = int_part.chars().collect();
    let mut result = String::new();
    for (index, ch) in chars.iter().enumerate() {
        if index > 0 && (chars.len() - index) % 3 == 0 {
            result.push(',');
        }
        result.push(*ch);
    }
    result
}

fn build_criteria_matcher(
    criterion: &ScalarValue,
) -> Result<Box<dyn Fn(&ScalarValue) -> bool>, FormulaError> {
    match criterion {
        ScalarValue::Number(number) => {
            let number = *number;
            Ok(Box::new(
                move |value| matches!(value, ScalarValue::Number(v) if *v == number),
            ))
        }
        ScalarValue::Boolean(boolean) => {
            let boolean = *boolean;
            Ok(Box::new(
                move |value| matches!(value, ScalarValue::Boolean(v) if *v == boolean),
            ))
        }
        ScalarValue::Empty => Ok(Box::new(|value| matches!(value, ScalarValue::Empty))),
        ScalarValue::Text(text) => build_text_criteria_matcher(text),
    }
}

fn build_text_criteria_matcher(
    criterion: &str,
) -> Result<Box<dyn Fn(&ScalarValue) -> bool>, FormulaError> {
    let ops = [">=", "<=", "<>", ">", "<", "="];
    let trimmed = criterion.trim();
    for op in ops {
        if let Some(rest) = trimmed.strip_prefix(op) {
            let target_text = rest.trim();
            if let Ok(target_num) = parse_value_string(target_text) {
                let cmp = op.to_string();
                return Ok(Box::new(move |value| {
                    coerce_number(value)
                        .map(|num| compare_numeric_criteria(num, target_num, &cmp))
                        .unwrap_or(false)
                }));
            }
            let target = target_text.to_string();
            let cmp = op.to_string();
            return Ok(Box::new(move |value| {
                compare_text_criteria(&text_value(value), &target, &cmp)
            }));
        }
    }
    let target = trimmed.to_string();
    Ok(Box::new(move |value| text_value(value) == target))
}

fn compare_numeric_criteria(value: f64, target: f64, op: &str) -> bool {
    match op {
        ">" => value > target,
        ">=" => value >= target,
        "<" => value < target,
        "<=" => value <= target,
        "<>" => value != target,
        "=" => value == target,
        _ => false,
    }
}

fn compare_text_criteria(value: &str, target: &str, op: &str) -> bool {
    match op {
        "=" => value == target,
        "<>" => value != target,
        ">" => value > target,
        ">=" => value >= target,
        "<" => value < target,
        "<=" => value <= target,
        _ => false,
    }
}

#[derive(Clone, Copy)]
struct SimpleDateTime {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
}

fn normalize_date_parts(year: i32, month: i32, day: i32) -> SimpleDateTime {
    let total_months = year * 12 + (month - 1);
    let normalized_year = total_months.div_euclid(12);
    let normalized_month = total_months.rem_euclid(12) + 1;
    let days = days_from_civil(normalized_year, normalized_month as u32, 1) + (day - 1) as i64;
    civil_from_days_into_datetime(days, 0)
}

fn date_to_serial(dt: SimpleDateTime) -> f64 {
    let epoch_days = days_from_civil(1899, 12, 30);
    let current_days = days_from_civil(dt.year, dt.month, dt.day);
    let seconds = dt.hour as f64 * 3600.0 + dt.minute as f64 * 60.0 + dt.second as f64;
    (current_days - epoch_days) as f64 + seconds / 86_400.0
}

fn serial_to_datetime(serial: f64) -> Result<SimpleDateTime, FormulaError> {
    let epoch_days = days_from_civil(1899, 12, 30);
    let whole_days = serial.floor() as i64;
    let mut seconds = ((serial - whole_days as f64) * 86_400.0).round() as i64;
    let mut day_offset = whole_days;
    if seconds >= 86_400 {
        seconds -= 86_400;
        day_offset += 1;
    }
    if seconds < 0 {
        seconds += 86_400;
        day_offset -= 1;
    }
    Ok(civil_from_days_into_datetime(
        epoch_days + day_offset,
        seconds,
    ))
}

fn parse_datetime_string(text: &str) -> Option<SimpleDateTime> {
    let trimmed = text.trim();
    if let Some((date, time)) = trimmed.split_once(' ') {
        let mut dt = parse_date_string(date)?;
        let (hour, minute, second) = parse_time_string(time)?;
        dt.hour = hour;
        dt.minute = minute;
        dt.second = second;
        return Some(dt);
    }
    parse_date_string(trimmed)
}

fn parse_date_string(text: &str) -> Option<SimpleDateTime> {
    let parts: Vec<_> = text.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let year = parts[0].parse::<i32>().ok()?;
    let month = parts[1].parse::<u32>().ok()?;
    let day = parts[2].parse::<u32>().ok()?;
    if month == 0 || month > 12 || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(SimpleDateTime {
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
    })
}

fn parse_time_string(text: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<_> = text.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let hour = parts[0].parse::<u32>().ok()?;
    let minute = parts[1].parse::<u32>().ok()?;
    let second = if parts.len() == 3 {
        parts[2].parse::<u32>().ok()?
    } else {
        0
    };
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    Some((hour, minute, second))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = month as i32 + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day as i32 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) as i64
}

fn civil_from_days_into_datetime(days: i64, seconds: i64) -> SimpleDateTime {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    SimpleDateTime {
        year: year as i32,
        month: month as u32,
        day: day as u32,
        hour: (seconds / 3600) as u32,
        minute: ((seconds % 3600) / 60) as u32,
        second: (seconds % 60) as u32,
    }
}

fn parse_cell_coord(value: &str) -> Option<CellCoord> {
    let mut col_part = String::new();
    let mut row_part = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphabetic() && row_part.is_empty() {
            col_part.push(ch.to_ascii_uppercase());
        } else if ch.is_ascii_digit() {
            row_part.push(ch);
        } else {
            return None;
        }
    }
    if col_part.is_empty() || row_part.is_empty() {
        return None;
    }
    let row_number = row_part.parse::<usize>().ok()?;
    if row_number == 0 {
        return None;
    }
    Some(CellCoord {
        row: row_number - 1,
        col: column_label_to_index(&col_part)?,
    })
}

pub fn coord_label(coord: &CellCoord) -> String {
    format!("{}{}", column_index_to_label(coord.col), coord.row + 1)
}

pub fn column_index_to_label(mut col: usize) -> String {
    let mut label = String::new();
    loop {
        let rem = col % 26;
        label.insert(0, (b'A' + rem as u8) as char);
        if col < 26 {
            break;
        }
        col = (col / 26) - 1;
    }
    label
}

fn column_label_to_index(label: &str) -> Option<usize> {
    let mut value = 0usize;
    for ch in label.chars() {
        if !ch.is_ascii_uppercase() {
            return None;
        }
        value = value.checked_mul(26)?;
        value = value.checked_add((ch as u8 - b'A' + 1) as usize)?;
    }
    value.checked_sub(1)
}

fn formula_error(code: FormulaErrorCode, message: String) -> FormulaError {
    FormulaError { code, message }
}

fn is_formula(input: &str) -> bool {
    input.starts_with('=')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::sheets_types::CellState;
    use std::collections::HashMap;
    use std::sync::Arc;

    struct MockAiProvider;

    impl AiFormulaProvider for MockAiProvider {
        fn generate(&self, prompt: &str, context: Option<&str>) -> Result<String, FormulaError> {
            Ok(match context {
                Some(context) if !context.is_empty() => {
                    format!("PROMPT:{prompt} | CONTEXT:{context}")
                }
                _ => format!("PROMPT:{prompt}"),
            })
        }
    }

    fn make_sheet(
        cells: Vec<(usize, usize, &str)>,
        row_count: usize,
        col_count: usize,
    ) -> SheetState {
        let mut map = HashMap::new();
        for (row, col, input) in cells {
            map.insert(
                CellCoord { row, col },
                CellState {
                    input: input.to_string(),
                    computed: ComputedValue::Empty,
                    error: None,
                    style_id: None,
                },
            );
        }
        SheetState {
            name: "Sheet1".to_string(),
            row_count,
            col_count,
            cells: map,
            used_range: None,
        }
    }

    #[test]
    fn recompute_supports_basic_arithmetic_and_references() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(vec![(0, 0, "2"), (0, 1, "=A1*3"), (0, 2, "=A1+B1")], 1, 3);
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(6.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Number(8.0)
        );
    }

    #[test]
    fn recompute_supports_ranges_and_functions() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![(0, 0, "1"), (1, 0, "2"), (2, 0, "3"), (0, 1, "=SUM(A1:A3)")],
            3,
            2,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(6.0)
        );
    }

    #[test]
    fn recompute_supports_string_literals_in_functions() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(vec![(0, 0, "=IF(TRUE, \"yes\", \"no\")")], 1, 1);
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
            ComputedValue::Text("yes".to_string())
        );
    }

    #[test]
    fn count_only_includes_numeric_values() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "1"),
                (1, 0, "TRUE"),
                (2, 0, "text"),
                (3, 0, ""),
                (0, 1, "=COUNT(A1:A4)"),
            ],
            4,
            2,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(1.0)
        );
    }

    #[test]
    fn logical_and_error_functions_work() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "=AND(TRUE, 1, \"x\")"),
                (0, 1, "=OR(FALSE, 0, \"x\")"),
                (0, 2, "=NOT(TRUE)"),
                (0, 3, "=IFERROR(1/0, \"fallback\")"),
                (0, 4, "=ISERROR(1/0)"),
            ],
            1,
            5,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
            ComputedValue::Boolean(true)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Boolean(true)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Boolean(false)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 3 }].computed,
            ComputedValue::Text("fallback".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 4 }].computed,
            ComputedValue::Boolean(true)
        );
    }

    #[test]
    fn math_and_stat_functions_work() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "=ROUND(1.234,2)"),
                (0, 1, "=ROUNDUP(1.231,2)"),
                (0, 2, "=ROUNDDOWN(1.239,2)"),
                (0, 3, "=INT(-1.2)"),
                (0, 4, "=ABS(-3)"),
                (0, 5, "=MOD(10,3)"),
                (0, 6, "=POWER(2,3)"),
                (0, 7, "=SQRT(9)"),
                (0, 8, "=MEDIAN(1,9,3,7)"),
            ],
            1,
            9,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
            ComputedValue::Number(1.23)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(1.24)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Number(1.23)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 3 }].computed,
            ComputedValue::Number(-2.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 4 }].computed,
            ComputedValue::Number(3.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 5 }].computed,
            ComputedValue::Number(1.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 6 }].computed,
            ComputedValue::Number(8.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 7 }].computed,
            ComputedValue::Number(3.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 8 }].computed,
            ComputedValue::Number(5.0)
        );
    }

    #[test]
    fn conditional_aggregate_functions_work() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "2"),
                (1, 0, "7"),
                (2, 0, "9"),
                (0, 1, "10"),
                (1, 1, "20"),
                (2, 1, "30"),
                (0, 2, "=SUMIF(A1:A3,\">5\",B1:B3)"),
                (1, 2, "=COUNTIF(A1:A3,\">5\")"),
                (2, 2, "=AVERAGEIF(A1:A3,\">5\",B1:B3)"),
            ],
            3,
            3,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Number(50.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 1, col: 2 }].computed,
            ComputedValue::Number(2.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 2, col: 2 }].computed,
            ComputedValue::Number(25.0)
        );
    }

    #[test]
    fn text_functions_work() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "=CONCAT(\"Hello\",\" \",\"World\")"),
                (0, 1, "=LEFT(\"Hello\",2)"),
                (0, 2, "=RIGHT(\"Hello\",2)"),
                (0, 3, "=MID(\"Hello\",2,3)"),
                (0, 4, "=LEN(\"Hello\")"),
                (0, 5, "=TRIM(\"  hello   world  \")"),
                (0, 6, "=UPPER(\"Hello\")"),
                (0, 7, "=LOWER(\"Hello\")"),
                (0, 8, "=PROPER(\"hello world\")"),
                (0, 9, "=FIND(\"lo\",\"Hello\")"),
                (0, 10, "=SUBSTITUTE(\"banana\",\"na\",\"x\",2)"),
                (0, 11, "=REPLACE(\"abcdef\",2,3,\"Z\")"),
                (0, 12, "=TEXT(1.234,\"0.00\")"),
                (0, 13, "=VALUE(\"42\")"),
                (0, 14, "=TEXT(1234.5,\"#,##0.00\")"),
                (0, 15, "=TEXT(0.125,\"0.0%\")"),
                (0, 16, "=VALUE(\"1,234.5\")"),
                (0, 17, "=VALUE(\"12.5%\")"),
            ],
            1,
            18,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
            ComputedValue::Text("Hello World".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Text("He".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Text("lo".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 3 }].computed,
            ComputedValue::Text("ell".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 4 }].computed,
            ComputedValue::Number(5.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 5 }].computed,
            ComputedValue::Text("hello world".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 6 }].computed,
            ComputedValue::Text("HELLO".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 7 }].computed,
            ComputedValue::Text("hello".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 8 }].computed,
            ComputedValue::Text("Hello World".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 9 }].computed,
            ComputedValue::Number(4.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 10 }].computed,
            ComputedValue::Text("banax".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 11 }].computed,
            ComputedValue::Text("aZef".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 12 }].computed,
            ComputedValue::Text("1.23".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 13 }].computed,
            ComputedValue::Number(42.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 14 }].computed,
            ComputedValue::Text("1,234.50".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 15 }].computed,
            ComputedValue::Text("12.5%".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 16 }].computed,
            ComputedValue::Number(1234.5)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 17 }].computed,
            ComputedValue::Number(0.125)
        );
    }

    #[test]
    fn date_time_and_info_functions_work() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "=DATE(2024,1,2)"),
                (0, 1, "=YEAR(DATE(2024,1,2))"),
                (0, 2, "=MONTH(DATE(2024,1,2))"),
                (0, 3, "=DAY(DATE(2024,1,2))"),
                (0, 4, "=HOUR(45293.5)"),
                (0, 5, "=MINUTE(45293.5013888889)"),
                (0, 6, "=SECOND(45293.501400463)"),
                (0, 7, "=ISBLANK(A2)"),
                (0, 8, "=ISNUMBER(3)"),
                (0, 9, "=ISTEXT(\"abc\")"),
                (0, 10, "=TEXT(DATE(2024,1,2),\"yyyy-mm-dd\")"),
                (0, 11, "=TEXT(DATE(2024,1,2)+0.5,\"yyyy-mm-dd hh:mm:ss\")"),
                (0, 12, "=VALUE(\"2024-01-02 12:00:00\")"),
                (0, 13, "=VALUE(\"12:34:56\")"),
            ],
            2,
            14,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
            ComputedValue::Number(2024.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Number(1.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 3 }].computed,
            ComputedValue::Number(2.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 4 }].computed,
            ComputedValue::Number(12.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 5 }].computed,
            ComputedValue::Number(2.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 6 }].computed,
            ComputedValue::Number(1.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 7 }].computed,
            ComputedValue::Boolean(true)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 8 }].computed,
            ComputedValue::Boolean(true)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 9 }].computed,
            ComputedValue::Boolean(true)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 10 }].computed,
            ComputedValue::Text("2024-01-02".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 11 }].computed,
            ComputedValue::Text("2024-01-02 12:00:00".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 12 }].computed,
            ComputedValue::Number(45293.5)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 13 }].computed,
            ComputedValue::Number((12.0 * 3600.0 + 34.0 * 60.0 + 56.0) / 86_400.0)
        );
        assert!(sheet.cells[&CellCoord { row: 0, col: 0 }].error.is_none());
    }

    #[test]
    fn conditional_criteria_supports_text_equality_and_numeric_comparators() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(
            vec![
                (0, 0, "apple"),
                (1, 0, "pear"),
                (2, 0, "apple"),
                (0, 1, "1"),
                (1, 1, "2"),
                (2, 1, "3"),
                (0, 2, "=COUNTIF(A1:A3,\"apple\")"),
                (1, 2, "=SUMIF(B1:B3,\">=2\")"),
            ],
            3,
            3,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Number(2.0)
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 1, col: 2 }].computed,
            ComputedValue::Number(5.0)
        );
    }

    #[test]
    fn ai_function_supports_prompt_and_optional_range() {
        let engine = BackendFormulaEngine::new(Some(Arc::new(MockAiProvider)));
        let mut sheet = make_sheet(
            vec![
                (0, 0, "Alice"),
                (0, 1, "flowers"),
                (0, 2, "=AI(\"Write thanks to \"&A1&\" for \"&B1)"),
                (1, 0, "Alice"),
                (1, 1, "flowers"),
                (1, 2, "=AI(\"Personalize note\", A2:B2)"),
            ],
            2,
            3,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
            ComputedValue::Text("PROMPT:Write thanks to Alice for flowers".to_string())
        );
        assert_eq!(
            sheet.cells[&CellCoord { row: 1, col: 2 }].computed,
            ComputedValue::Text(
                "PROMPT:Personalize note | CONTEXT:1: Alice\n2: flowers".to_string()
            )
        );
    }

    #[test]
    fn ai_function_supports_string_concat_prompt_with_cell_reference() {
        let engine = BackendFormulaEngine::new(Some(Arc::new(MockAiProvider)));
        let mut sheet = make_sheet(
            vec![(3, 1, "book"), (3, 2, "=AI(\"what is a synonym for \"&B4)")],
            4,
            3,
        );
        engine.recompute_sheet(&mut sheet).unwrap();
        assert_eq!(
            sheet.cells[&CellCoord { row: 3, col: 2 }].computed,
            ComputedValue::Text("PROMPT:what is a synonym for book".to_string())
        );
    }

    #[test]
    fn recompute_surfaces_circular_reference_errors() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(vec![(0, 0, "=B1"), (0, 1, "=A1")], 1, 2);
        engine.recompute_sheet(&mut sheet).unwrap();
        assert!(sheet.cells[&CellCoord { row: 0, col: 0 }]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("circular reference"));
    }

    #[test]
    fn recompute_surfaces_invalid_reference_errors() {
        let engine = BackendFormulaEngine::new(None);
        let mut sheet = make_sheet(vec![(0, 0, "=Z99")], 1, 1);
        engine.recompute_sheet(&mut sheet).unwrap();
        assert!(sheet.cells[&CellCoord { row: 0, col: 0 }]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("invalid reference"));
    }

    #[cfg(feature = "ironcalc-engine")]
    mod ironcalc_parity {
        use super::*;

        fn recompute_with_ironcalc(
            cells: Vec<(usize, usize, &str)>,
            row_count: usize,
            col_count: usize,
        ) -> SheetState {
            let engine = IronCalcEngine::new();
            let mut sheet = make_sheet(cells, row_count, col_count);
            engine.recompute_sheet(&mut sheet).unwrap();
            sheet
        }

        #[test]
        fn ironcalc_basic_arithmetic_and_references() {
            let sheet =
                recompute_with_ironcalc(vec![(0, 0, "2"), (0, 1, "=A1*3"), (0, 2, "=A1+B1")], 1, 3);
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
                ComputedValue::Number(2.0)
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Number(6.0)
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 2 }].computed,
                ComputedValue::Number(8.0)
            );
        }

        #[test]
        fn ironcalc_sum_range() {
            let sheet = recompute_with_ironcalc(
                vec![(0, 0, "1"), (1, 0, "2"), (2, 0, "3"), (0, 1, "=SUM(A1:A3)")],
                3,
                2,
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Number(6.0)
            );
        }

        #[test]
        fn ironcalc_circular_reference_surfaces_error() {
            let sheet = recompute_with_ironcalc(vec![(0, 0, "=B1"), (0, 1, "=A1")], 1, 2);
            assert!(sheet.cells[&CellCoord { row: 0, col: 0 }].error.is_some());
            assert!(sheet.cells[&CellCoord { row: 0, col: 1 }].error.is_some());
        }

        #[test]
        fn ironcalc_division_by_zero_surfaces_error() {
            let sheet = recompute_with_ironcalc(vec![(0, 0, "10"), (0, 1, "=A1/0")], 1, 2);
            assert!(sheet.cells[&CellCoord { row: 0, col: 1 }].error.is_some());
        }

        #[test]
        fn ironcalc_average_function() {
            let sheet = recompute_with_ironcalc(
                vec![
                    (0, 0, "10"),
                    (1, 0, "20"),
                    (2, 0, "30"),
                    (0, 1, "=AVERAGE(A1:A3)"),
                ],
                3,
                2,
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Number(20.0)
            );
        }

        #[test]
        fn ironcalc_if_function() {
            let sheet = recompute_with_ironcalc(
                vec![(0, 0, "5"), (0, 1, "=IF(A1>3,\"yes\",\"no\")")],
                1,
                2,
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Text("yes".to_string())
            );
        }

        #[test]
        fn ironcalc_boolean_literals() {
            let sheet = recompute_with_ironcalc(vec![(0, 0, "TRUE"), (0, 1, "FALSE")], 1, 2);
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 0 }].computed,
                ComputedValue::Boolean(true)
            );
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Boolean(false)
            );
        }

        #[test]
        fn ironcalc_text_values() {
            let sheet =
                recompute_with_ironcalc(vec![(0, 0, "hello"), (0, 1, "=A1&\" world\"")], 1, 2);
            assert_eq!(
                sheet.cells[&CellCoord { row: 0, col: 1 }].computed,
                ComputedValue::Text("hello world".to_string())
            );
        }

        #[test]
        fn ironcalc_parity_with_backend_arithmetic() {
            let cells = vec![
                (0, 0, "2"),
                (0, 1, "=A1*3"),
                (0, 2, "=A1+B1"),
                (1, 0, "10"),
                (1, 1, "=SUM(A1:A3)"),
                (1, 2, "=AVERAGE(B1:B2)"),
            ];

            let mut backend_sheet = make_sheet(cells.clone(), 3, 3);
            BackendFormulaEngine::new(None)
                .recompute_sheet(&mut backend_sheet)
                .unwrap();

            let mut ironcalc_sheet = make_sheet(cells, 3, 3);
            IronCalcEngine::new()
                .recompute_sheet(&mut ironcalc_sheet)
                .unwrap();

            for coord in backend_sheet.cells.keys() {
                let backend_cell = backend_sheet.cells.get(coord).unwrap();
                let ironcalc_cell = ironcalc_sheet.cells.get(coord).unwrap();
                assert_eq!(
                    backend_cell.computed, ironcalc_cell.computed,
                    "mismatch at {:?}: backend={:?}, ironcalc={:?}",
                    coord, backend_cell.computed, ironcalc_cell.computed
                );
                assert_eq!(
                    backend_cell.error.is_some(),
                    ironcalc_cell.error.is_some(),
                    "error state mismatch at {:?}: backend={:?}, ironcalc={:?}",
                    coord,
                    backend_cell.error,
                    ironcalc_cell.error
                );
            }
        }
    }
}
