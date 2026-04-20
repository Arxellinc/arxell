use crate::services::sheets_types::{CellCoord, ComputedValue, SheetState};
use std::collections::HashMap;
use thiserror::Error;

#[cfg(feature = "ironcalc-engine")]
use ironcalc::base::{cell::CellValue, types::CellType, Model};

pub trait FormulaEngine: Send + Sync {
    fn recompute_sheet(&self, sheet: &mut SheetState) -> Result<(), FormulaError>;
    fn validate(&self, input: &str) -> Result<(), FormulaError>;
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
pub struct BackendFormulaEngine;

impl BackendFormulaEngine {
    pub fn new() -> Self {
        Self
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
        let mut evaluator = Evaluator::new(&inputs, row_count, col_count);
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

pub fn create_engine() -> Box<dyn FormulaEngine> {
    #[cfg(feature = "ironcalc-engine")]
    {
        Box::new(IronCalcEngine::new())
    }
    #[cfg(not(feature = "ironcalc-engine"))]
    {
        Box::new(BackendFormulaEngine::new())
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
}

impl<'a> Evaluator<'a> {
    fn new(inputs: &'a HashMap<CellCoord, String>, row_count: usize, col_count: usize) -> Self {
        Self {
            inputs,
            row_count,
            col_count,
            memo: HashMap::new(),
            visiting: Vec::new(),
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
            _ => Err(formula_error(
                FormulaErrorCode::UnsupportedFormula,
                format!("unsupported formula function {upper}"),
            )),
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
    LParen,
    RParen,
    Comma,
    Colon,
    Plus,
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
        if self.consume(&Token::LParen) {
            let expr = self.parse_expression()?;
            self.expect(Token::RParen)?;
            return Ok(expr);
        }
        let Some(Token::Ident(ident)) = self.peek().cloned() else {
            return Err(formula_error(
                FormulaErrorCode::ParseFailure,
                "expected a value in formula".to_string(),
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
        .filter(|value| !matches!(value, ScalarValue::Empty))
        .count()
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
        let engine = BackendFormulaEngine::new();
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
        let engine = BackendFormulaEngine::new();
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
    fn recompute_surfaces_circular_reference_errors() {
        let engine = BackendFormulaEngine::new();
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
        let engine = BackendFormulaEngine::new();
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
            BackendFormulaEngine::new()
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
