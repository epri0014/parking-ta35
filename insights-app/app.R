# =========================
# Libraries
# =========================
library(shiny)
library(readr)
library(readxl)
library(dplyr)
library(tidyr)
library(stringr)
library(janitor)
library(purrr)
library(tibble)
library(ggplot2)
library(plotly)
library(DT)
library(scales)

options(scipen = 999)
`%||%` <- function(a, b) if (is.null(a)) b else a

# =========================
# Styling
# =========================
app_css <- HTML("\n.value-box { background:#0d6efd10; border:1px solid #0d6efd30; border-radius:14px; padding:14px; }\n.value-box h5 { margin:0; opacity:.8; font-weight:600; }\n.value-box h3 { margin:2px 0 0; font-weight:800; letter-spacing:.2px; }\n.value-box.green { background:#19875412; border-color:#19875433; }\n.section-title { margin-top:6px; margin-bottom:2px; }\n.subtle { color:#6c757d; margin:0 0 8px 0; }\nhr { margin: 10px 0 14px 0; }\n.insight { background:#fff; border-left:4px solid #0d6efd; padding:10px 12px; border-radius:6px; }\n.insight h4 { margin:0 0 6px 0; font-weight:700; }\n.insight p { margin:0; line-height:1.4; }\n")

# ==========================================================
# ================ AC 1.1 - VEHICLES (CSV) =================
# ==========================================================
veh_csv <- "data/Australian Bureau of Statistics.csv"

if (!file.exists(veh_csv)) stop("Missing file: data/Australian Bureau of Statistics.csv")

veh_raw <- readr::read_csv(veh_csv, col_names = FALSE, show_col_types = FALSE,
                           na = c("", "NA", "-", "-")) %>%
           mutate(across(everything(), ~ if (is.character(.x)) trimws(.x) else .x))

if (nrow(veh_raw) >= 3 && ncol(veh_raw) >= 3) {
  hdr1 <- as.character(veh_raw[1, ])
  hdr2 <- as.character(veh_raw[2, ])
  data <- veh_raw[-c(1,2), ]
  names(data) <- paste0("X", seq_len(ncol(data)))

  # forward fill header row 1
  ffill <- function(x){
    last <- NA_character_; out <- character(length(x))
    for (i in seq_along(x)) {
      if (!is.na(x[i]) && nzchar(x[i]) && !grepl("^Unnamed", x[i], ignore.case = TRUE)) last <- x[i]
      out[i] <- last
    }
    out
  }
  periods <- ffill(hdr1)

  # normalise subheaders
  sub <- tolower(gsub("\\.+$", "", hdr2))
  sub[sub %in% c("%","percent","perc","per cent")] <- "percent"
  sub[is.na(sub) | sub == ""] <- "no"

  # find state column by value hits
  state_pat <- "(?i)^(nsw|new south wales|vic\\.?|victoria|qld|queensland|wa|western australia|sa|south australia|tas|tasmania|act|australian capital territory|nt|northern territory)\\b"
  scan_rows <- seq_len(min(nrow(data), 30))
  hit_counts <- sapply(seq_len(ncol(data)), function(j){
    vals <- as.character(data[scan_rows, j]); vals <- vals[!is.na(vals)]
    sum(stringr::str_detect(vals, state_pat))
  })
  state_idx <- if (any(hit_counts > 0)) which.max(hit_counts) else 1L

  meta <- tibble(col_index = seq_len(ncol(data)),
                 colname = paste0("X", col_index),
                 period = periods,
                 metric = sub) %>%
          mutate(is_period = grepl("^\\s*Between\\s*\\d{4}\\s*and\\s*\\d{4}\\s*$", period) &
                              metric %in% c("no","percent"))

  sel_meta <- meta %>% filter(is_period, col_index != state_idx)
  if (nrow(sel_meta) == 0) {
    has_two_years <- grepl("\\b\\d{4}\\b.*\\b\\d{4}\\b", meta$period)
    sel_meta <- meta %>% filter(has_two_years, col_index != state_idx)
    sel_meta$metric[!sel_meta$metric %in% c("no","percent")] <- "no"
  }
  yr_mat <- stringr::str_match(sel_meta$period, "(?i)between\\s*(\\d{4}).*?and\\s*(\\d{4})")
  sel_meta$start_year <- suppressWarnings(as.integer(yr_mat[,2]))
  sel_meta$end_year   <- suppressWarnings(as.integer(yr_mat[,3]))
  sel_meta <- sel_meta %>% filter(!is.na(start_year), !is.na(end_year))

  if (nrow(sel_meta) > 0) {
    keep_df <- data[, c(state_idx, sel_meta$col_index)]
    names(keep_df)[1] <- "state"
    pretty_names <- paste0("Between ", sel_meta$start_year, " and ", sel_meta$end_year, "_", sel_meta$metric)
    names(keep_df)[-1] <- pretty_names

    long_df <- keep_df %>%
      tidyr::pivot_longer(cols = -state, names_to = "period_metric", values_to = "value_raw")
    pm_mat <- stringr::str_match(long_df$period_metric, "Between\\s*(\\d{4})\\s*and\\s*(\\d{4})_(no|percent)")
    long_df$start_year <- as.integer(pm_mat[,2])
    long_df$end_year   <- as.integer(pm_mat[,3])
    long_df$metric     <- pm_mat[,4]
    long_df$value      <- readr::parse_number(as.character(long_df$value_raw))
    long_df$period_lab <- paste0(long_df$start_year, "-", long_df$end_year)

    vic_long <- long_df %>%
      filter(stringr::str_detect(stringr::str_to_lower(state), "^\\s*vic\\.?\\s*$|\\bvictoria\\b") |
             stringr::str_detect(stringr::str_to_lower(state), "^\\s*vic")) %>%
      arrange(end_year, metric)
  } else {
    vic_long <- tibble()
  }
} else {
  vic_long <- tibble()
}

# ==========================================================
# ============== AC 1.2 - POPULATION (EXCEL) ===============
# ==========================================================
pop_xlsx <- "data/32180DS0001_2001-21.xlsx"
if (!file.exists(pop_xlsx)) stop("Missing file: data/32180DS0001_2001-21.xlsx")

sheets <- tryCatch(readxl::excel_sheets(pop_xlsx), error = function(e) character())

read_pop_auto <- function(){
  if (!length(sheets)) return(tibble())
  for (sh in sheets) {
    x <- tryCatch(readxl::read_excel(pop_xlsx, sheet = sh, col_names = FALSE), error = function(e) NULL)
    if (is.null(x) || nrow(x) < 3) next
    x <- as.data.frame(x, stringsAsFactors = FALSE)
    x <- x[rowSums(is.na(x) | x == "") < ncol(x), , drop = FALSE]
    x <- x[, colSums(is.na(x) | x == "") < nrow(x), drop = FALSE]
    if (nrow(x) < 3 || ncol(x) < 3) next

    row_has_years <- sapply(seq_len(nrow(x)), function(i){
      vals <- as.character(unlist(x[i, ], use.names = FALSE))
      years_found <- stringr::str_extract_all(vals, "(19|20)\\d{2}") |> unlist()
      sum(!is.na(as.integer(years_found)))
    })
    hdr_idx <- which(row_has_years >= 3)
    if (!length(hdr_idx)) next
    hdr_idx <- hdr_idx[1]

    hdr_vals <- as.character(unlist(x[hdr_idx, ], use.names = FALSE))
    year_idx <- which(stringr::str_detect(hdr_vals, "(19|20)\\d{2}"))
    if (!length(year_idx)) next
    year_labels <- stringr::str_extract(hdr_vals[year_idx], "(19|20)\\d{2}")

    data_block <- x[(hdr_idx+1):nrow(x), , drop = FALSE]
    data_block[is.na(data_block)] <- ""
    reg_hits <- sapply(seq_len(ncol(data_block)), function(j){
      vals <- tolower(as.character(data_block[seq_len(min(200, nrow(data_block))), j, drop = TRUE]))
      sum(grepl("melbourne", vals))
    })
    region_idx <- if (any(reg_hits > 0)) which.max(reg_hits) else 1L
    region_idx <- max(1L, min(region_idx, ncol(data_block)))
    year_idx <- year_idx[year_idx <= ncol(data_block)]

    df <- data_block[, c(region_idx, year_idx), drop = FALSE]
    names(df) <- c("region", year_labels)
    df$region <- as.character(df$region)
    df <- df[df$region != "" & !is.na(df$region), , drop = FALSE]

    long <- suppressWarnings(
      df %>%
        tidyr::pivot_longer(cols = -region, names_to = "year", values_to = "population") %>%
        mutate(
          year = as.integer(gsub("\\D","", year)),
          population = readr::parse_number(as.character(population))
        ) %>%
        filter(!is.na(year), !is.na(population))
    )
    mel <- long %>% filter(grepl("(?i)melbourne", region))
    if (nrow(mel)) {
      mel <- mel %>% arrange(region, year) %>%
        group_by(region) %>%
        mutate(yoy = population - dplyr::lag(population),
               yoy_pct = 100 * yoy / dplyr::lag(population)) %>%
        ungroup()
      return(mel)
    }
  }
  tibble()
}
pop_auto <- read_pop_auto()
sheet_choices <- if (length(sheets)) sheets else character()

# ==========================================================
# ========================  UI  ============================
# ==========================================================
ui <- fluidPage(
  tags$head(tags$style(app_css)),

  tabsetPanel(
    id = "tabs",

    # -------- AC 1.1 --------
    tabPanel(
      title = "Car Ownership (VIC)",
      div(class="section-title", h2("Victoria: Car Ownership Growth")),
      p(class="subtle", "Data source: ABS - Motor Vehicle Census"),
      hr(),
      uiOutput("controls_veh"),
      uiOutput("cards_veh"),
      plotlyOutput("plot_veh", height = "440px"),
      tags$br(),
      uiOutput("insight_veh"),
      tags$br(),
      DT::dataTableOutput("table_veh"),
      tags$br(),
      downloadButton("download_veh", "Download filtered CSV", class = "btn btn-primary")
    ),

    # -------- AC 1.2 --------
    tabPanel(
      title = "Population (Melbourne)",
      div(class="section-title", h2("Population Growth (Melbourne)")),
      p(class="subtle", "Data source: ABS - 32180DS0001"),
      hr(),
      uiOutput("controls_pop"),
      uiOutput("cards_pop"),
      plotlyOutput("plot_pop", height = "440px"),
      tags$br(),
      uiOutput("insight_pop"),
      tags$br(),
      DT::dataTableOutput("table_pop"),
      tags$br(),
      downloadButton("download_pop", "Download filtered CSV", class = "btn btn-success")
    )
  )
)

# ==========================================================
# =================== SERVER LOGIC =========================
# ==========================================================
server <- function(input, output, session){

  # ---------- AC 1.1 controls ----------
  output$controls_veh <- renderUI({
    if (!exists("vic_long") || !nrow(vic_long)) {
      return(tags$div(class="alert alert-warning",
        h4("Vehicle table could not be parsed"),
        p("Confirm CSV path: data/Australian Bureau of Statistics.csv")))
    }
    fluidRow(
      column(5,
        radioButtons("veh_metric", "Metric",
          choices = c("Growth (Number)" = "no", "Growth (%)" = "percent"),
          selected = "no", inline = TRUE
        )
      ),
      column(7,
        selectizeInput("veh_periods", "Periods",
          choices = sort(unique(vic_long$period_lab)),
          selected = sort(unique(vic_long$period_lab)),
          multiple = TRUE, options = list(plugins = list("remove_button"))
        )
      )
    )
  })

  veh_sel <- reactive({
    req(exists("vic_long"), nrow(vic_long) > 0)
    m <- (input$veh_metric %||% "no")
    p <- (input$veh_periods %||% unique(vic_long$period_lab))
    vic_long %>% filter(metric == m, period_lab %in% p)
  })

  veh_stats <- reactive({
    df <- veh_sel(); if (!nrow(df)) return(NULL)
    latest_end <- max(df$end_year, na.rm = TRUE)
    latest <- df %>% filter(end_year == latest_end)
    list(
      latest_period = paste0(min(latest$start_year, na.rm = TRUE), "-", latest_end),
      latest_value  = sum(latest$value, na.rm = TRUE),
      n_periods     = length(unique(df$period_lab)),
      is_pct        = identical(input$veh_metric, "percent")
    )
  })

  output$cards_veh <- renderUI({
    ks <- veh_stats(); if (is.null(ks)) return(NULL)
    val <- if (ks$is_pct) sprintf("%.1f%%", ks$latest_value) else scales::number(ks$latest_value, big.mark=",")
    fluidRow(
      column(4, div(class="value-box", h5("Latest period"), h3(ks$latest_period))),
      column(4, div(class="value-box", h5("Latest value"),  h3(val))),
      column(4, div(class="value-box", h5("Periods shown"), h3(ks$n_periods)))
    )
  })

  output$plot_veh <- renderPlotly({
    df <- veh_sel(); req(nrow(df) > 0)
    y_lab <- if (identical(input$veh_metric, "percent")) "Percent" else "Number of vehicles"
    hover_txt <- paste0("Period: ", df$period_lab, "<br>Value: ",
                        if (identical(input$veh_metric, "percent")) sprintf("%.1f%%", df$value) else scales::number(df$value, big.mark=","))
    p <- ggplot(df, aes(end_year, value, group = 1, text = hover_txt)) +
      geom_line(linewidth = 1.2, color = "#0d6efd") +
      geom_point(size = 2.2, color = "#0d6efd") +
      scale_x_continuous(breaks = df$end_year, labels = df$period_lab) +
      scale_y_continuous(labels = scales::label_number(big.mark=",")) +
      labs(title = "Victoria - Growth in Registered Motor Vehicles by Period",
           subtitle = "Parsed from two-row ABS header (Between ... and ... / no·%)",
           x = "Period", y = y_lab) +
      theme_minimal(base_size = 13)
    ggplotly(p, tooltip = "text") %>% layout(margin = list(b = 80))
  })

  output$insight_veh <- renderUI({
    df <- veh_sel(); if (!nrow(df)) return(NULL)
    df <- df %>% arrange(end_year)
    first_lab <- df$period_lab[1]; last_lab <- df$period_lab[nrow(df)]
    first_val <- df$value[1];       last_val <- df$value[nrow(df)]
    delta_abs <- last_val - first_val
    i_max <- which.max(df$value); i_min <- which.min(df$value)
    peak_lab <- df$period_lab[i_max]; peak_val <- df$value[i_max]
    low_lab  <- df$period_lab[i_min]; low_val <- df$value[i_min]
    last_delta <- if (nrow(df) >= 2) last_val - df$value[nrow(df)-1] else NA
    is_pct <- identical(input$veh_metric, "percent")
    fmt <- function(x) if (is_pct) sprintf("%.1f%%", x) else scales::number(x, big.mark = ",")
    HTML(paste0(
      '<div class="insight">',
      '<h4>Insights</h4>',
      '<p><strong>Trend:</strong> From <em>', first_lab, "</em> to <em>", last_lab, "</em>, ",
      if (delta_abs>=0) "growth increased by " else "growth decreased by ",
      "<strong>", fmt(abs(delta_abs)), "</strong>.</p>",
      '<p><strong>Peak:</strong> ', if (is_pct) "Highest % growth" else "Largest increase",
      " in <em>", peak_lab, "</em> at <strong>", fmt(peak_val), "</strong>. ",
      "<strong>Lowest:</strong> <em>", low_lab, "</em> at <strong>", fmt(low_val), "</strong>.</p>",
      if (!is.na(last_delta))
        paste0('<p><strong>Latest movement:</strong> The most recent period (', last_lab, ") ",
               if (last_delta>=0) "rose by " else "fell by ",
               "<strong>", fmt(abs(last_delta)), "</strong> vs the previous period.</p>") else "",
      '</div>'
    ))
  })

  output$table_veh <- DT::renderDataTable({
    df <- veh_sel(); req(nrow(df) > 0)
    wide <- df %>% select(period = period_lab, metric, value) %>% tidyr::pivot_wider(names_from = metric, values_from = value)
    if ("no" %in% names(wide))      wide$no      <- scales::number(wide$no, big.mark = ",")
    if ("percent" %in% names(wide)) wide$percent <- sprintf("%.1f", wide$percent)
    datatable(wide, extensions = "Buttons",
              options = list(pageLength = 8, dom = "Bfrtip", buttons = c("copy","csv","excel","print")),
              rownames = FALSE)
  })

  output$download_veh <- downloadHandler(
    filename = function(){ paste0("vic_car_ownership_", Sys.Date(), ".csv") },
    content  = function(file){ readr::write_csv(veh_sel(), file) }
  )

  # ---------- AC 1.2 controls & reactives ----------
  if (nrow(pop_auto) > 0) {
    # Auto mode controls
    output$controls_pop <- renderUI({
      all_regions <- sort(unique(pop_auto$region))
      yr_min <- min(pop_auto$year, na.rm = TRUE)
      yr_max <- max(pop_auto$year, na.rm = TRUE)
      fluidRow(
        column(6,
          selectizeInput("pop_regions", "Melbourne region(s)",
            choices = all_regions,
            selected = head(all_regions, 5),
            multiple = TRUE, options = list(plugins = list("remove_button","drag_drop"))
          )
        ),
        column(6,
          sliderInput("pop_years", "Year range",
            min = yr_min, max = yr_max,
            value = c(max(2010, yr_min), yr_max), step = 1, sep = "")
        )
      )
    })

    pop_sel <- reactive({
      req(nrow(pop_auto) > 0, input$pop_regions, input$pop_years)
      pop_auto %>% filter(region %in% input$pop_regions,
                          year >= input$pop_years[1], year <= input$pop_years[2])
    })

  } else {
    # Manual picker fallback
    output$controls_pop <- renderUI({
      if (!length(sheet_choices)) {
        return(tags$div(class="alert alert-warning",
          h4("Population workbook not found"),
          p("Confirm Excel path: data/32180DS0001_2001-21.xlsx")))
      }
      fluidRow(
        column(4, selectInput("pick_sheet", "Sheet", choices = sheet_choices)),
        column(4, uiOutput("pick_geo")),
        column(4, uiOutput("pick_years"))
      )
    })

    sheet_df <- reactive({
      req(input$pick_sheet)
      suppressMessages(readxl::read_excel(pop_xlsx, sheet = input$pick_sheet)) |> tibble::as_tibble()
    })

    output$pick_geo <- renderUI({
      df <- sheet_df(); req(ncol(df) > 1)
      cand <- names(df)
      guess <- which.max(grepl("name|area|region|lga|gccsa|sa2|sa3|city", cand, ignore.case = TRUE))
      selectInput("geo_col", "Region / Area column", choices = cand, selected = ifelse(guess>0, cand[guess], cand[1]))
    })

    output$pick_years <- renderUI({
      df <- sheet_df(); req(ncol(df) > 1)
      cand_years <- names(df)[grepl("^\\s*(19|20)\\d{2}\\s*$", names(df))]
      if (!length(cand_years)) {
        num_cols <- names(df)[sapply(df, is.numeric)]
        cand_years <- num_cols
      }
      selectizeInput("year_cols", "Year columns",
                     choices = names(df),
                     selected = cand_years,
                     multiple = TRUE, options = list(plugins = list("remove_button","drag_drop")))
    })

    pop_sel <- reactive({
      req(input$geo_col, input$year_cols)
      df <- sheet_df()
      keep <- c(input$geo_col, input$year_cols)
      keep <- keep[keep %in% names(df)]
      req(length(keep) >= 2)
      long <- df %>%
        select(all_of(keep)) %>%
        tidyr::pivot_longer(cols = all_of(setdiff(keep, input$geo_col)),
                     names_to = "year", values_to = "population") %>%
        rename(region = all_of(input$geo_col)) %>%
        mutate(
          year = suppressWarnings(as.integer(gsub("\\D","", as.character(year)))),
          population = readr::parse_number(as.character(population))
        ) %>%
        filter(!is.na(year), !is.na(population),
               grepl("(?i)melbourne", region)) %>%
        arrange(region, year) %>%
        group_by(region) %>%
        mutate(yoy = population - dplyr::lag(population),
               yoy_pct = 100 * yoy / dplyr::lag(population)) %>%
        ungroup()
      long
    })
  }

  # KPIs shared
  pop_kpis <- reactive({
    df <- pop_sel(); if (!nrow(df)) return(NULL)
    latest_y <- max(df$year, na.rm = TRUE)
    latest <- df %>% filter(year == latest_y)
    base_y  <- min(df$year, na.rm = TRUE)
    base    <- df %>% filter(year == base_y)
    list(
      base_year    = base_y,
      latest_year  = latest_y,
      total_latest = sum(latest$population, na.rm = TRUE),
      total_base   = sum(base$population, na.rm = TRUE),
      growth_abs   = sum(latest$population, na.rm = TRUE) - sum(base$population, na.rm = TRUE),
      growth_pct   = 100 * (sum(latest$population, na.rm = TRUE) / sum(base$population, na.rm = TRUE) - 1),
      regions_n    = length(unique(df$region))
    )
  })

  output$cards_pop <- renderUI({
    ks <- pop_kpis(); if (is.null(ks)) return(NULL)
    fluidRow(
      column(3, div(class="value-box green", h5("Latest year"),  h3(ks$latest_year))),
      column(3, div(class="value-box green", h5("Latest total"), h3(scales::number(ks$total_latest, big.mark=",")))),
      column(3, div(class="value-box green", h5("Growth (abs)"), h3(scales::number(ks$growth_abs, big.mark=",")))),
      column(3, div(class="value-box green", h5("Growth (%)"),  h3(sprintf("%.1f%%", ks$growth_pct))))
    )
  })

  output$plot_pop <- renderPlotly({
    df <- pop_sel(); req(nrow(df) > 0)
    p <- ggplot(df, aes(year, population, color = region, group = region)) +
      geom_line(linewidth = 1.1) +
      geom_point(size = 2) +
      scale_y_continuous(labels = scales::label_number(big.mark=",")) +
      scale_x_continuous(breaks = pretty(df$year)) +
      labs(title = "Melbourne Population Growth",
           subtitle = "ABS 32180DS0001 (selected regions / years)",
           x = "Year", y = "Population", color = "Region") +
      theme_minimal(base_size = 13)
    ggplotly(p, tooltip = c("x","y","color")) %>% layout(legend = list(orientation = "h"))
  })

  output$insight_pop <- renderUI({
    ks <- pop_kpis(); df <- pop_sel()
    if (is.null(ks) || !nrow(df)) return(NULL)
    yoy_summary <- df %>% group_by(region) %>%
      filter(!is.na(yoy_pct)) %>%
      slice_max(order_by = yoy_pct, n = 1, with_ties = FALSE) %>%
      ungroup() %>% arrange(desc(yoy_pct))
    top_line <- if (nrow(yoy_summary)) {
      top <- yoy_summary[1,]
      paste0("Fastest annual growth among selected regions was in <em>", top$region,
             "</em> (", top$year, ") at <strong>", sprintf("%.1f%%", top$yoy_pct), "</strong>.")
    } else {
      "Year-on-year percentage changes are not available for the selected range."
    }
    HTML(paste0(
      '<div class="insight">',
      '<h4>Insights</h4>',
      '<p><strong>Overall growth:</strong> From <em>', ks$base_year, "</em> to <em>", ks$latest_year,
      "</em>, the selected regions grew by <strong>", sprintf("%.1f%%", ks$growth_pct),
      "</strong> (", scales::number(ks$growth_abs, big.mark=","), " people).</p>",
      '<p><strong>Latest size:</strong> Combined population in ', ks$latest_year, " is <strong>",
      scales::number(ks$total_latest, big.mark=","), "</strong> across <strong>", ks$regions_n, "</strong> region(s).</p>",
      '<p>', top_line, '</p>',
      '</div>'
    ))
  })

  output$table_pop <- DT::renderDataTable({
    df <- pop_sel(); req(nrow(df) > 0)
    view <- df %>% arrange(region, year) %>%
      transmute(region, year,
                population = scales::number(population, big.mark = ","),
                yoy = ifelse(is.na(yoy), NA, scales::number(yoy, big.mark=",")),
                yoy_pct = ifelse(is.na(yoy_pct), NA, sprintf("%.1f%%", yoy_pct)))
    datatable(view, extensions = "Buttons",
              options = list(pageLength = 10, dom = "Bfrtip", buttons = c("copy","csv","excel","print")),
              rownames = FALSE)
  })

  output$download_pop <- downloadHandler(
    filename = function(){ paste0("melbourne_population_", Sys.Date(), ".csv") },
    content  = function(file){ readr::write_csv(pop_sel(), file) }
  )
}

shinyApp(ui, server)
