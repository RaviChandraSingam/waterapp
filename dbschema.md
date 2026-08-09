## Table `audit_log`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `action` | `varchar` |  |
| `entity_type` | `varchar` |  |
| `entity_id` | `uuid` |  Nullable |
| `old_values` | `jsonb` |  Nullable |
| `new_values` | `jsonb` |  Nullable |
| `created_at` | `timestamp` |  Nullable |

## Table `billing_config`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `config_key` | `varchar` |  Unique |
| `config_value` | `numeric` |  |
| `description` | `varchar` |  Nullable |
| `updated_by` | `uuid` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |

## Table `blocks`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `varchar` |  Unique |
| `display_name` | `varchar` |  |

## Table `common_area_readings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `monthly_record_id` | `uuid` |  |
| `common_area_id` | `uuid` |  |
| `start_reading` | `numeric` |  |
| `end_reading` | `numeric` |  |
| `consumption_litres` | `numeric` |  Nullable |
| `captured_by` | `uuid` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |

## Table `common_areas`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `varchar` |  |
| `description` | `varchar` |  Nullable |
| `is_active` | `bool` |  Nullable |

## Table `cost_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `monthly_record_id` | `uuid` |  |
| `item_name` | `varchar` |  |
| `amount` | `numeric` |  |
| `created_at` | `timestamp` |  Nullable |

## Table `flat_billing`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `monthly_record_id` | `uuid` |  |
| `flat_id` | `uuid` |  |
| `start_reading` | `numeric` |  Nullable |
| `end_reading` | `numeric` |  Nullable |
| `consumption_litres` | `numeric` |  Nullable |
| `slab1_qty` | `numeric` |  Nullable |
| `slab2_qty` | `numeric` |  Nullable |
| `slab3_qty` | `numeric` |  Nullable |
| `slab1_cost` | `numeric` |  Nullable |
| `slab2_cost` | `numeric` |  Nullable |
| `slab3_cost` | `numeric` |  Nullable |
| `total_cost` | `numeric` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |

## Table `flats`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `block_id` | `uuid` |  |
| `flat_number` | `varchar` |  |
| `is_active` | `bool` |  Nullable |

## Table `meter_readings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `monthly_record_id` | `uuid` |  |
| `flat_id` | `uuid` |  |
| `reading_date` | `date` |  |
| `reading_value` | `numeric` |  |
| `reading_sequence` | `int4` |  |
| `captured_by` | `uuid` |  Nullable |
| `has_warning` | `bool` |  Nullable |
| `warning_message` | `text` |  Nullable |
| `is_verified` | `bool` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |

## Table `monthly_records`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `year` | `int4` |  |
| `month` | `int4` |  |
| `status` | `record_status` |  Nullable |
| `period_start_date` | `date` |  |
| `period_end_date` | `date` |  |
| `mid_period_date` | `date` |  Nullable |
| `cost_per_litre` | `numeric` |  Nullable |
| `total_water_input` | `numeric` |  Nullable |
| `total_water_usage` | `numeric` |  Nullable |
| `notes` | `text` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `reviewed_by` | `uuid` |  Nullable |
| `finalized_by` | `uuid` |  Nullable |
| `reviewed_at` | `timestamp` |  Nullable |
| `finalized_at` | `timestamp` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |

## Table `users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `username` | `varchar` |  Unique |
| `password_hash` | `varchar` |  |
| `full_name` | `varchar` |  |
| `role` | `user_role` |  |
| `is_active` | `bool` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |
| `must_change_password` | `bool` |  Nullable |
| `can_manage_users` | `bool` |  Nullable |
| `is_superadmin` | `bool` |  Nullable |

## Table `water_source_readings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `monthly_record_id` | `uuid` |  |
| `water_source_id` | `uuid` |  |
| `start_reading` | `numeric` |  Nullable |
| `end_reading` | `numeric` |  Nullable |
| `unit_count` | `numeric` |  Nullable |
| `consumption_litres` | `numeric` |  Nullable |
| `total_cost` | `numeric` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `cost_per_unit` | `numeric` |  Nullable |

## Table `water_sources`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `varchar` |  |
| `source_type` | `varchar` |  |
| `capacity_litres` | `numeric` |  Nullable |
| `cost_per_unit` | `numeric` |  Nullable |
| `is_active` | `bool` |  Nullable |

## Table `pending_items`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `title` | `varchar` |  |
| `category` | `varchar` |  |
| `priority` | `varchar` |  |
| `planned_period` | `varchar` |  Nullable |
| `associated_cost` | `numeric` |  Nullable |
| `recurring` | `bool` |  |
| `recurrence_pattern` | `varchar` |  Nullable |
| `status` | `varchar` |  |
| `progress_pct` | `int4` |  |
| `worked_on_by` | `varchar` |  Nullable |
| `description` | `text` |  Nullable |
| `notes` | `text` |  Nullable |
| `due_date` | `date` |  Nullable |
| `completed_at` | `timestamp` |  Nullable |
| `created_by` | `uuid` |  Nullable |
| `updated_by` | `uuid` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamp` |  Nullable |
| `seq_no` | `int4` |  |

## Table `page_visits`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `page` | `varchar` |  |
| `visited_at` | `timestamp` |  Nullable |

## Custom Types / Enums

### `record_status`

`draft` | `captured` | `reviewed` | `final`

### `user_role`

`plumber` | `accountant` | `watercommittee` | `guest`

