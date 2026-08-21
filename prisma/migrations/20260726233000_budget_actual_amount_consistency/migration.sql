-- Correct legacy stored actuals to the application status contract.
-- PostgreSQL integer overflow aborts the statement instead of skipping a CAS version bump.
UPDATE "budget_items"
SET
    "actual_amount" = CASE "booking_status"
        WHEN 'PLANNING' THEN NULL
        WHEN 'BOOKED_BALANCE_DUE' THEN "deposit_amount"
        WHEN 'PAID' THEN "planned_amount"
    END,
    "version" = "version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "actual_amount" IS DISTINCT FROM CASE "booking_status"
    WHEN 'PLANNING' THEN NULL
    WHEN 'BOOKED_BALANCE_DUE' THEN "deposit_amount"
    WHEN 'PAID' THEN "planned_amount"
END;
