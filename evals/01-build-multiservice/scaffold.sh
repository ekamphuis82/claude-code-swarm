#!/usr/bin/env bash
set -euo pipefail
mkdir -p booking-api/src/main/java/nl/example/booking booking-api/src/main/resources/db/migration \
  payments-core/src/main/java/nl/example/payments admin-gui/src/pages
cat > booking-api/src/main/java/nl/example/booking/Booking.java <<'EOF'
package nl.example.booking;

public class Booking {
    public enum Status { PENDING, CONFIRMED, COMPLETED }
    private long id;
    private Status status = Status.PENDING;
    private long amountCents;
    public Status getStatus() { return status; }
    public void confirm() { status = Status.CONFIRMED; }
}
EOF
cat > booking-api/src/main/java/nl/example/booking/BookingController.java <<'EOF'
package nl.example.booking;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/bookings")
public class BookingController {
    @PostMapping("/{id}/confirm")
    public void confirm(@PathVariable long id) { /* ... */ }
}
EOF
cat > booking-api/src/main/resources/db/migration/V1__bookings.sql <<'EOF'
CREATE TABLE booking (id BIGINT PRIMARY KEY, status VARCHAR(16) NOT NULL, amount_cents BIGINT NOT NULL);
EOF
cat > payments-core/src/main/java/nl/example/payments/PaymentService.java <<'EOF'
package nl.example.payments;

import java.math.BigDecimal;

public class PaymentService {
    public String charge(long bookingId, BigDecimal amount) { return "psp-ref"; }
}
EOF
cat > admin-gui/src/pages/BookingList.vue <<'EOF'
<template>
  <q-table :rows="bookings" row-key="id" />
</template>
<script setup lang="ts">
defineProps<{ bookings: { id: number; status: string }[] }>()
</script>
EOF
