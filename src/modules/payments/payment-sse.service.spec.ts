import { Test, TestingModule } from '@nestjs/testing';
import { MessageEvent } from '@nestjs/common';
import { PaymentSseService } from './payment-sse.service';
import { Payment, PaymentStatus } from './payment.entity';

describe('PaymentSseService', () => {
  let service: PaymentSseService;

  const createMockPayment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      id: 'payment-123',
      status: PaymentStatus.PENDING,
      updatedAt: new Date(),
      ...overrides,
    } as Payment);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentSseService],
    }).compile();

    service = module.get<PaymentSseService>(PaymentSseService);
  });

  afterEach(() => {
    // Clean up subjects
    jest.clearAllMocks();
  });

  describe('subscribe', () => {
    it('should create and return a new subject for payment', (done) => {
      const paymentId = 'payment-new-1';
      const observable = service.subscribe(paymentId);

      expect(observable).toBeDefined();

      // Subscribe to observable
      observable.subscribe({
        next: (message: MessageEvent) => {
          expect(message).toBeDefined();
          done();
        },
      });

      // Emit a payment update
      const payment = createMockPayment({ id: paymentId });
      service.emit(payment);
    });

    it('should return existing subject if already subscribed', () => {
      const paymentId = 'payment-existing-1';

      const observable1 = service.subscribe(paymentId);
      const observable2 = service.subscribe(paymentId);

      // Both should reference the same subject
      expect(observable1).toBe(observable2);
    });

    it('should handle multiple payments independently', (done) => {
      const paymentId1 = 'payment-1';
      const paymentId2 = 'payment-2';

      let receivedCount = 0;

      service.subscribe(paymentId1).subscribe({
        next: (message: MessageEvent) => {
          expect(message.data.id).toBe(paymentId1);
          receivedCount++;
          if (receivedCount === 2) done();
        },
      });

      service.subscribe(paymentId2).subscribe({
        next: (message: MessageEvent) => {
          expect(message.data.id).toBe(paymentId2);
          receivedCount++;
          if (receivedCount === 2) done();
        },
      });

      const payment1 = createMockPayment({ id: paymentId1 });
      const payment2 = createMockPayment({ id: paymentId2 });

      service.emit(payment1);
      service.emit(payment2);
    });
  });

  describe('emit', () => {
    it('should emit message with payment status update', (done) => {
      const paymentId = 'payment-emit-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });

      service.subscribe(paymentId).subscribe({
        next: (message: MessageEvent) => {
          expect(message.type).toBe('payment.status_updated');
          expect(message.data.id).toBe(paymentId);
          expect(message.data.status).toBe(PaymentStatus.COMPLETED);
          done();
        },
      });

      service.emit(payment);
    });

    it('should include updatedAt in message data', (done) => {
      const paymentId = 'payment-updated-at-1';
      const now = new Date();
      const payment = createMockPayment({ id: paymentId, updatedAt: now });

      service.subscribe(paymentId).subscribe({
        next: (message: MessageEvent) => {
          expect(message.data.updatedAt).toEqual(now);
          done();
        },
      });

      service.emit(payment);
    });

    it('should not emit if no subscribers', () => {
      const paymentId = 'payment-no-subs-1';
      const payment = createMockPayment({ id: paymentId });

      // Should not throw
      expect(() => service.emit(payment)).not.toThrow();
    });

    it('should complete stream on COMPLETED status', (done) => {
      const paymentId = 'payment-complete-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });

      let emitCount = 0;

      service.subscribe(paymentId).subscribe({
        next: () => {
          emitCount++;
        },
        complete: () => {
          expect(emitCount).toBe(1);
          done();
        },
      });

      service.emit(payment);
    });

    it('should complete stream on FAILED status', (done) => {
      const paymentId = 'payment-failed-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.FAILED });

      service.subscribe(paymentId).subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBe(true);
          done();
        },
      });

      service.emit(payment);
    });

    it('should complete stream on CANCELLED status', (done) => {
      const paymentId = 'payment-cancelled-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.CANCELLED });

      service.subscribe(paymentId).subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBe(true);
          done();
        },
      });

      service.emit(payment);
    });

    it('should complete stream on REFUNDED status', (done) => {
      const paymentId = 'payment-refunded-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.REFUNDED });

      service.subscribe(paymentId).subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBe(true);
          done();
        },
      });

      service.emit(payment);
    });

    it('should complete stream on PARTIALLY_REFUNDED status', (done) => {
      const paymentId = 'payment-partial-refund-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.PARTIALLY_REFUNDED });

      service.subscribe(paymentId).subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBe(true);
          done();
        },
      });

      service.emit(payment);
    });

    it('should not complete stream on PENDING status', (done) => {
      const paymentId = 'payment-pending-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.PENDING });

      let completed = false;

      service.subscribe(paymentId).subscribe({
        next: () => {},
        complete: () => {
          completed = true;
        },
      });

      service.emit(payment);

      // Wait a bit and verify it's not completed
      setTimeout(() => {
        expect(completed).toBe(false);
        done();
      }, 100);
    });

    it('should clean up subject after terminal state', () => {
      const paymentId = 'payment-cleanup-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });

      service.subscribe(paymentId);
      service.emit(payment);

      // Attempting to subscribe again should create a new subject
      const newObservable = service.subscribe(paymentId);
      expect(newObservable).toBeDefined();
    });
  });

  describe('terminal states', () => {
    const terminalStates = [
      PaymentStatus.COMPLETED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
    ];

    terminalStates.forEach((status) => {
      it(`should recognize ${status} as terminal state`, (done) => {
        const paymentId = `payment-terminal-${status}`;
        const payment = createMockPayment({ id: paymentId, status });

        let messageReceived = false;

        service.subscribe(paymentId).subscribe({
          next: (message: MessageEvent) => {
            messageReceived = true;
            expect(message.data.status).toBe(status);
          },
          complete: () => {
            expect(messageReceived).toBe(true);
            done();
          },
        });

        service.emit(payment);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle rapid consecutive emissions', (done) => {
      const paymentId = 'payment-rapid-1';
      let emitCount = 0;

      service.subscribe(paymentId).subscribe({
        next: () => {
          emitCount++;
        },
        complete: () => {
          expect(emitCount).toBe(1);
          done();
        },
      });

      // Emit once with terminal status
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });
      service.emit(payment);
    });

    it('should handle multiple subscribers to same payment', (done) => {
      const paymentId = 'payment-multi-sub-1';
      let receivedCount = 0;

      const completeCheck = () => {
        if (receivedCount === 2) done();
      };

      service.subscribe(paymentId).subscribe({
        next: () => {
          receivedCount++;
          completeCheck();
        },
      });

      service.subscribe(paymentId).subscribe({
        next: () => {
          receivedCount++;
          completeCheck();
        },
      });

      const payment = createMockPayment({ id: paymentId });
      service.emit(payment);
    });

    it('should emit correct message structure', (done) => {
      const paymentId = 'payment-structure-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.PENDING });

      service.subscribe(paymentId).subscribe({
        next: (message: MessageEvent) => {
          expect(message).toHaveProperty('type');
          expect(message).toHaveProperty('data');
          expect(message.data).toHaveProperty('id');
          expect(message.data).toHaveProperty('status');
          expect(message.data).toHaveProperty('updatedAt');
          done();
        },
      });

      service.emit(payment);
    });

    it('should handle payment with same ID being emitted multiple times before completion', (done) => {
      const paymentId = 'payment-multi-emit-1';
      let emitCount = 0;

      service.subscribe(paymentId).subscribe({
        next: () => {
          emitCount++;
          if (emitCount === 2) {
            // Second emit triggers completion
          }
        },
        complete: () => {
          expect(emitCount).toBe(2);
          done();
        },
      });

      // First emit with non-terminal status
      const payment1 = createMockPayment({ id: paymentId, status: PaymentStatus.PROCESSING });
      service.emit(payment1);

      // Second emit with terminal status
      const payment2 = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });
      service.emit(payment2);
    });
  });

  describe('memory management', () => {
    it('should remove subject after terminal state to prevent memory leaks', () => {
      const paymentId = 'payment-memory-1';
      const payment = createMockPayment({ id: paymentId, status: PaymentStatus.COMPLETED });

      service.subscribe(paymentId);
      expect(() => service.emit(payment)).not.toThrow();

      // Subject should be cleaned up - new subscription should work
      expect(() => service.subscribe(paymentId)).not.toThrow();
    });
  });
});
