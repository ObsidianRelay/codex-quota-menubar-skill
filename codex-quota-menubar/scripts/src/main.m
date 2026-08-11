#import <Cocoa/Cocoa.h>
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <mach/mach.h>
#include <math.h>
#include <signal.h>
#include <unistd.h>

static const NSInteger CQWeeklyWindowMinutes = 10080;
static const NSTimeInterval CQReadTimeoutSeconds = 9.0;
static const NSTimeInterval CQQuotaRefreshSeconds = 180.0;
static const NSTimeInterval CQSystemSampleSeconds = 1.0;
static const NSUInteger CQCPUHistoryLimit = 60;
static const CGFloat CQPanelWidth = 470.0;
static const CGFloat CQPanelHeight = 728.0;

static NSColor *CQColor(CGFloat red, CGFloat green, CGFloat blue, CGFloat alpha) {
    return [NSColor colorWithSRGBRed:red / 255.0
                               green:green / 255.0
                                blue:blue / 255.0
                               alpha:alpha];
}

static NSNumber *CQNumberFromValue(id value) {
    if ([value isKindOfClass:NSNumber.class]) {
        return value;
    }
    if ([value isKindOfClass:NSString.class]) {
        return [[[NSNumberFormatter alloc] init] numberFromString:value];
    }
    return nil;
}

static NSString *CQPlanDisplayName(NSString *planType) {
    if (planType.length == 0) return @"待读取";
    NSDictionary<NSString *, NSString *> *names = @{
        @"free": @"Free", @"go": @"Go", @"plus": @"Plus", @"pro": @"Pro",
        @"prolite": @"Pro Lite", @"team": @"Team", @"business": @"Business",
        @"self_serve_business_prolite": @"Business Pro Lite",
        @"self_serve_business_usage_based": @"Business",
        @"ent26": @"Enterprise", @"enterprise_cbp_usage_based": @"Enterprise",
        @"enterprise": @"Enterprise", @"edu": @"Edu", @"unknown": @"未知"
    };
    return names[planType.lowercaseString] ?: planType;
}

static NSString *CQFormatTokenCount(NSNumber *number) {
    if (number == nil) return @"—";
    double value = number.doubleValue;
    if (value >= 1000000000.0) return [NSString stringWithFormat:@"%.1fB", value / 1000000000.0];
    if (value >= 1000000.0) return [NSString stringWithFormat:@"%.1fM", value / 1000000.0];
    if (value >= 1000.0) return [NSString stringWithFormat:@"%.1fK", value / 1000.0];
    return [NSString stringWithFormat:@"%.0f", value];
}

// 将额度重置时间转换为便于快速查看的倒计时，不显示负数。
static NSString *CQFormatResetCountdown(NSDate *resetDate, NSDate *now) {
    if (resetDate == nil) return @"未知";
    NSDate *referenceDate = now ?: NSDate.date;
    NSTimeInterval remaining = [resetDate timeIntervalSinceDate:referenceDate];
    if (remaining <= 0.0) return @"即将重置";
    NSInteger totalHours = (NSInteger)floor(remaining / 3600.0);
    if (totalHours < 1) return @"不足 1 小时";
    NSInteger days = totalHours / 24;
    NSInteger hours = totalHours % 24;
    if (days > 0) {
        return [NSString stringWithFormat:@"%ld 天 %ld 小时", (long)days, (long)hours];
    }
    return [NSString stringWithFormat:@"%ld 小时", (long)hours];
}

// 日均只统计本月已经产生 Token 的日期，不把未来日期和空日期计入分母。
static NSNumber *CQAverageRecordedDailyTokens(NSArray<NSNumber *> *values) {
    double total = 0.0;
    NSUInteger recordedDays = 0;
    for (NSNumber *number in values) {
        double value = MAX(0.0, number.doubleValue);
        if (value <= 0.0) continue;
        total += value;
        recordedDays++;
    }
    return recordedDays > 0 ? @(total / recordedDays) : nil;
}

static NSNumber *CQPeakDailyTokens(NSArray<NSNumber *> *values) {
    double peak = 0.0;
    for (NSNumber *number in values) peak = MAX(peak, number.doubleValue);
    return peak > 0.0 ? @(peak) : nil;
}

@interface CQQuotaSnapshot : NSObject
@property(nonatomic, strong, nullable) NSNumber *remainingPercent;
@property(nonatomic, strong, nullable) NSDate *resetDate;
@property(nonatomic, strong) NSDate *checkedAt;
@property(nonatomic, copy, nullable) NSString *planType;
@property(nonatomic, strong, nullable) NSNumber *monthlyTokens;
@property(nonatomic, copy, nullable) NSArray<NSNumber *> *dailyTokenUsage;
@property(nonatomic, copy, nullable) NSString *errorMessage;
+ (instancetype)successWithRemaining:(NSInteger)remaining
                           resetDate:(nullable NSDate *)resetDate
                           checkedAt:(NSDate *)checkedAt;
+ (instancetype)failureWithMessage:(NSString *)message checkedAt:(NSDate *)checkedAt;
- (BOOL)isAvailable;
@end

@implementation CQQuotaSnapshot

+ (instancetype)successWithRemaining:(NSInteger)remaining
                           resetDate:(NSDate *)resetDate
                           checkedAt:(NSDate *)checkedAt {
    CQQuotaSnapshot *snapshot = [[CQQuotaSnapshot alloc] init];
    snapshot.remainingPercent = @(remaining);
    snapshot.resetDate = resetDate;
    snapshot.checkedAt = checkedAt;
    return snapshot;
}

+ (instancetype)failureWithMessage:(NSString *)message checkedAt:(NSDate *)checkedAt {
    CQQuotaSnapshot *snapshot = [[CQQuotaSnapshot alloc] init];
    snapshot.checkedAt = checkedAt;
    snapshot.errorMessage = message;
    return snapshot;
}

- (BOOL)isAvailable { return self.remainingPercent != nil; }

@end

@interface CQRateLimitReader : NSObject
+ (CQQuotaSnapshot *)snapshotFromRatePayload:(NSDictionary *)payload checkedAt:(NSDate *)checkedAt;
+ (void)applyUsagePayload:(NSDictionary *)payload
               toSnapshot:(CQQuotaSnapshot *)snapshot
                       now:(NSDate *)now;
- (CQQuotaSnapshot *)readSynchronously;
@end

@implementation CQRateLimitReader

+ (CQQuotaSnapshot *)snapshotFromRatePayload:(NSDictionary *)payload checkedAt:(NSDate *)checkedAt {
    NSMutableArray<NSDictionary *> *snapshots = [NSMutableArray array];
    id direct = payload[@"rateLimits"];
    if ([direct isKindOfClass:NSDictionary.class]) [snapshots addObject:direct];
    id byLimitID = payload[@"rateLimitsByLimitId"];
    if ([byLimitID isKindOfClass:NSDictionary.class]) {
        for (id value in [byLimitID allValues]) {
            if ([value isKindOfClass:NSDictionary.class]) [snapshots addObject:value];
        }
    }
    if ([payload[@"primary"] isKindOfClass:NSDictionary.class]) [snapshots addObject:payload];

    for (NSDictionary *candidate in snapshots) {
        NSDictionary *primary = candidate[@"primary"];
        if (![primary isKindOfClass:NSDictionary.class]) continue;
        NSNumber *duration = CQNumberFromValue(primary[@"windowDurationMins"]);
        NSNumber *used = CQNumberFromValue(primary[@"usedPercent"]);
        if (duration == nil || used == nil || duration.integerValue != CQWeeklyWindowMinutes) continue;

        NSInteger remaining = MAX(0, MIN(100, 100 - lround(used.doubleValue)));
        NSDate *resetDate = nil;
        NSNumber *resetTimestamp = CQNumberFromValue(primary[@"resetsAt"]);
        if (resetTimestamp != nil) {
            NSTimeInterval timestamp = resetTimestamp.doubleValue;
            if (timestamp > 10000000000.0) timestamp /= 1000.0;
            resetDate = [NSDate dateWithTimeIntervalSince1970:timestamp];
        }

        CQQuotaSnapshot *snapshot = [CQQuotaSnapshot successWithRemaining:remaining
                                                                resetDate:resetDate
                                                                checkedAt:checkedAt];
        NSString *planType = candidate[@"planType"];
        if ([planType isKindOfClass:NSString.class]) snapshot.planType = planType;
        return snapshot;
    }
    return [CQQuotaSnapshot failureWithMessage:@"没有找到真实的每周额度" checkedAt:checkedAt];
}

+ (void)applyUsagePayload:(NSDictionary *)payload
               toSnapshot:(CQQuotaSnapshot *)snapshot
                       now:(NSDate *)now {
    NSArray *buckets = payload[@"dailyUsageBuckets"];
    if (![buckets isKindOfClass:NSArray.class]) return;

    NSCalendar *calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
    calendar.timeZone = NSTimeZone.localTimeZone;
    NSDateComponents *current = [calendar components:(NSCalendarUnitYear | NSCalendarUnitMonth)
                                            fromDate:now];
    NSRange dayRange = [calendar rangeOfUnit:NSCalendarUnitDay
                                      inUnit:NSCalendarUnitMonth
                                     forDate:now];
    NSMutableArray<NSNumber *> *days = [NSMutableArray arrayWithCapacity:dayRange.length];
    for (NSUInteger index = 0; index < dayRange.length; index++) [days addObject:@0];

    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    formatter.calendar = calendar;
    formatter.timeZone = NSTimeZone.localTimeZone;
    formatter.dateFormat = @"yyyy-MM-dd";

    long long total = 0;
    for (id value in buckets) {
        if (![value isKindOfClass:NSDictionary.class]) continue;
        NSString *dateString = value[@"startDate"];
        NSNumber *tokens = CQNumberFromValue(value[@"tokens"]);
        if (![dateString isKindOfClass:NSString.class] || tokens == nil) continue;
        NSDate *date = [formatter dateFromString:dateString];
        if (date == nil) continue;
        NSDateComponents *parts = [calendar components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay)
                                              fromDate:date];
        if (parts.year != current.year || parts.month != current.month || parts.day < 1 ||
            (NSUInteger)parts.day > days.count) continue;
        long long count = MAX(0LL, tokens.longLongValue);
        days[(NSUInteger)parts.day - 1] = @(count);
        total += count;
    }
    snapshot.dailyTokenUsage = days.copy;
    snapshot.monthlyTokens = @(total);
}

- (NSArray<NSString *> *)appServerCandidates {
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    NSString *overridePath = NSProcessInfo.processInfo.environment[@"CODEX_QUOTA_APP_SERVER_PATH"];
    if (overridePath.length > 0) [paths addObject:overridePath];
    NSString *home = NSHomeDirectory();
    [paths addObjectsFromArray:@[
        [home stringByAppendingPathComponent:@".codex/plugins/.plugin-appserver/codex"],
        @"/opt/homebrew/bin/codex", @"/usr/local/bin/codex",
        [home stringByAppendingPathComponent:@".local/bin/codex"]
    ]];
    return paths;
}

- (BOOL)sendJSONObject:(NSDictionary *)object toHandle:(NSFileHandle *)handle {
    if (![NSJSONSerialization isValidJSONObject:object]) return NO;
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (data == nil) return NO;
    @try {
        [handle writeData:data];
        [handle writeData:[NSData dataWithBytes:"\n" length:1]];
        return YES;
    } @catch (__unused NSException *exception) {
        return NO;
    }
}

- (NSDictionary *)payloadFromResponse:(NSDictionary *)response {
    NSDictionary *result = response[@"result"];
    return [result isKindOfClass:NSDictionary.class] ? result : response;
}

- (CQQuotaSnapshot *)queryBinaryAtPath:(NSString *)binaryPath {
    NSDate *checkedAt = [NSDate date];
    NSTask *task = [[NSTask alloc] init];
    NSPipe *inputPipe = [NSPipe pipe];
    NSPipe *outputPipe = [NSPipe pipe];
    NSPipe *errorPipe = [NSPipe pipe];
    task.executableURL = [NSURL fileURLWithPath:binaryPath];
    task.arguments = @[@"app-server", @"--listen", @"stdio://"];
    task.standardInput = inputPipe;
    task.standardOutput = outputPipe;
    task.standardError = errorPipe;

    dispatch_semaphore_t responseSemaphore = dispatch_semaphore_create(0);
    NSLock *lock = [[NSLock alloc] init];
    __block NSMutableData *receiveBuffer = [NSMutableData data];
    __block NSDictionary *rateResponse = nil;
    __block NSDictionary *usageResponse = nil;
    __block BOOL didSignal = NO;
    void (^signalOnce)(void) = ^{
        BOOL shouldSignal = NO;
        [lock lock];
        if (!didSignal) { didSignal = YES; shouldSignal = YES; }
        [lock unlock];
        if (shouldSignal) dispatch_semaphore_signal(responseSemaphore);
    };

    NSData *newlineData = [NSData dataWithBytes:"\n" length:1];
    outputPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *chunk = handle.availableData;
        if (chunk.length == 0) { signalOnce(); return; }
        BOOL complete = NO;
        [lock lock];
        [receiveBuffer appendData:chunk];
        while (receiveBuffer.length > 0) {
            NSRange range = [receiveBuffer rangeOfData:newlineData options:0
                                                 range:NSMakeRange(0, receiveBuffer.length)];
            if (range.location == NSNotFound) break;
            NSData *line = [receiveBuffer subdataWithRange:NSMakeRange(0, range.location)];
            [receiveBuffer replaceBytesInRange:NSMakeRange(0, NSMaxRange(range))
                                     withBytes:NULL length:0];
            if (line.length == 0) continue;
            id object = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
            if (![object isKindOfClass:NSDictionary.class]) continue;
            NSDictionary *dictionary = object;
            NSNumber *identifier = CQNumberFromValue(dictionary[@"id"]);
            if (identifier.integerValue == 2 || dictionary[@"rateLimits"] != nil) {
                rateResponse = dictionary;
            } else if (identifier.integerValue == 3 || dictionary[@"dailyUsageBuckets"] != nil) {
                usageResponse = dictionary;
            }
            complete = rateResponse != nil && usageResponse != nil;
        }
        [lock unlock];
        if (complete) signalOnce();
    };
    errorPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        (void)handle.availableData;
    };
    task.terminationHandler = ^(__unused NSTask *endedTask) { signalOnce(); };

    NSError *launchError = nil;
    if (![task launchAndReturnError:&launchError]) {
        outputPipe.fileHandleForReading.readabilityHandler = nil;
        errorPipe.fileHandleForReading.readabilityHandler = nil;
        return [CQQuotaSnapshot failureWithMessage:@"无法启动 Codex App Server" checkedAt:checkedAt];
    }

    NSDictionary *initialize = @{
        @"jsonrpc": @"2.0", @"id": @1, @"method": @"initialize",
        @"params": @{
            @"clientInfo": @{@"name": @"codex-quota-menubar", @"version": @"2.1.0",
                              @"title": @"Codex Quota Menu Bar"},
            @"capabilities": @{@"experimentalApi": @YES}
        }
    };
    NSDictionary *initialized = @{@"jsonrpc": @"2.0", @"method": @"initialized", @"params": NSNull.null};
    NSDictionary *readRate = @{@"jsonrpc": @"2.0", @"id": @2,
                               @"method": @"account/rateLimits/read", @"params": NSNull.null};
    NSDictionary *readUsage = @{@"jsonrpc": @"2.0", @"id": @3,
                                @"method": @"account/usage/read", @"params": NSNull.null};
    NSFileHandle *writer = inputPipe.fileHandleForWriting;
    BOOL sent = [self sendJSONObject:initialize toHandle:writer] &&
                [self sendJSONObject:initialized toHandle:writer] &&
                [self sendJSONObject:readRate toHandle:writer] &&
                [self sendJSONObject:readUsage toHandle:writer];
    if (!sent) signalOnce();

    dispatch_time_t timeout = dispatch_time(DISPATCH_TIME_NOW,
        (int64_t)(CQReadTimeoutSeconds * NSEC_PER_SEC));
    (void)dispatch_semaphore_wait(responseSemaphore, timeout);

    outputPipe.fileHandleForReading.readabilityHandler = nil;
    errorPipe.fileHandleForReading.readabilityHandler = nil;
    task.terminationHandler = nil;
    if (task.running) {
        [task terminate];
        for (NSInteger attempt = 0; attempt < 20 && task.running; attempt++) usleep(50000);
        if (task.running) kill(task.processIdentifier, SIGKILL);
    }
    [task waitUntilExit];

    [lock lock];
    NSDictionary *rate = rateResponse;
    NSDictionary *usage = usageResponse;
    [lock unlock];
    if (rate == nil) {
        return [CQQuotaSnapshot failureWithMessage:@"Codex App Server 没有返回额度数据" checkedAt:checkedAt];
    }
    NSDictionary *errorObject = rate[@"error"];
    if ([errorObject isKindOfClass:NSDictionary.class]) {
        NSString *message = errorObject[@"message"];
        if (![message isKindOfClass:NSString.class] || message.length == 0) message = @"Codex App Server 返回错误";
        return [CQQuotaSnapshot failureWithMessage:message checkedAt:checkedAt];
    }

    CQQuotaSnapshot *snapshot = [CQRateLimitReader snapshotFromRatePayload:[self payloadFromResponse:rate]
                                                                 checkedAt:checkedAt];
    if (snapshot.isAvailable && usage != nil && ![usage[@"error"] isKindOfClass:NSDictionary.class]) {
        [CQRateLimitReader applyUsagePayload:[self payloadFromResponse:usage]
                                  toSnapshot:snapshot now:checkedAt];
    }
    return snapshot;
}

- (CQQuotaSnapshot *)readSynchronously {
    NSFileManager *manager = NSFileManager.defaultManager;
    NSString *lastError = @"暂时无法读取";
    BOOL foundExecutable = NO;
    for (NSString *path in [self appServerCandidates]) {
        if (![manager isExecutableFileAtPath:path]) continue;
        foundExecutable = YES;
        CQQuotaSnapshot *snapshot = [self queryBinaryAtPath:path];
        if (snapshot.isAvailable) return snapshot;
        if (snapshot.errorMessage.length > 0) lastError = snapshot.errorMessage;
    }
    if (!foundExecutable) lastError = @"没有找到 Codex App Server";
    return [CQQuotaSnapshot failureWithMessage:lastError checkedAt:NSDate.date];
}

@end

@interface CQSystemSample : NSObject
@property(nonatomic) double cpuTotalPercent;
@property(nonatomic) double cpuSystemPercent;
@property(nonatomic, copy) NSString *memoryPressureLabel;
@property(nonatomic) double memoryPressurePosition;
@end
@implementation CQSystemSample
@end

static NSString *CQMemoryPressureLabelForAvailableRatio(double ratio) {
    if (ratio >= 0.18) return @"正常";
    if (ratio >= 0.07) return @"注意";
    return @"紧张";
}

static double CQMemoryPressurePositionForAvailableRatio(double ratio) {
    if (ratio >= 0.18) return 0.15;
    if (ratio >= 0.07) return 0.58;
    return 0.90;
}

static double CQFanTurnsPerSecond(double cpuPercent) {
    double normalized = MAX(0.0, MIN(100.0, cpuPercent)) / 100.0;
    return 0.30 + 2.70 * normalized;
}

@interface CQSystemMonitor : NSObject
@property(nonatomic) host_cpu_load_info_data_t previousCPUInfo;
@property(nonatomic) BOOL hasPreviousCPUInfo;
- (CQSystemSample *)sample;
@end

@implementation CQSystemMonitor

- (CQSystemSample *)sample {
    CQSystemSample *sample = [[CQSystemSample alloc] init];
    sample.memoryPressureLabel = @"正常";
    sample.memoryPressurePosition = 0.15;
    host_cpu_load_info_data_t cpuInfo;
    mach_msg_type_number_t cpuCount = HOST_CPU_LOAD_INFO_COUNT;
    kern_return_t cpuResult = host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO,
                                              (host_info_t)&cpuInfo, &cpuCount);
    if (cpuResult == KERN_SUCCESS) {
        if (self.hasPreviousCPUInfo) {
            uint64_t user = (natural_t)(cpuInfo.cpu_ticks[CPU_STATE_USER] - self.previousCPUInfo.cpu_ticks[CPU_STATE_USER]);
            uint64_t system = (natural_t)(cpuInfo.cpu_ticks[CPU_STATE_SYSTEM] - self.previousCPUInfo.cpu_ticks[CPU_STATE_SYSTEM]);
            uint64_t nice = (natural_t)(cpuInfo.cpu_ticks[CPU_STATE_NICE] - self.previousCPUInfo.cpu_ticks[CPU_STATE_NICE]);
            uint64_t idle = (natural_t)(cpuInfo.cpu_ticks[CPU_STATE_IDLE] - self.previousCPUInfo.cpu_ticks[CPU_STATE_IDLE]);
            uint64_t total = user + system + nice + idle;
            if (total > 0) {
                sample.cpuTotalPercent = 100.0 * (double)(user + system + nice) / (double)total;
                sample.cpuSystemPercent = 100.0 * (double)system / (double)total;
            }
        }
        self.previousCPUInfo = cpuInfo;
        self.hasPreviousCPUInfo = YES;
    }

    vm_statistics64_data_t vmInfo;
    mach_msg_type_number_t vmCount = HOST_VM_INFO64_COUNT;
    kern_return_t vmResult = host_statistics64(mach_host_self(), HOST_VM_INFO64,
                                               (host_info64_t)&vmInfo, &vmCount);
    vm_size_t pageSize = 0;
    if (vmResult == KERN_SUCCESS && host_page_size(mach_host_self(), &pageSize) == KERN_SUCCESS && pageSize > 0) {
        uint64_t totalMemory = NSProcessInfo.processInfo.physicalMemory;
        uint64_t availablePages = (uint64_t)vmInfo.free_count + (uint64_t)vmInfo.inactive_count +
                                  (uint64_t)vmInfo.speculative_count + (uint64_t)vmInfo.purgeable_count;
        double availableRatio = totalMemory > 0
            ? MIN(1.0, (double)(availablePages * (uint64_t)pageSize) / (double)totalMemory) : 1.0;
        sample.memoryPressureLabel = CQMemoryPressureLabelForAvailableRatio(availableRatio);
        sample.memoryPressurePosition = CQMemoryPressurePositionForAvailableRatio(availableRatio);
    }
    return sample;
}

@end

@interface CQCPUChartView : NSView
@property(nonatomic, copy) NSArray<NSNumber *> *totalHistory;
@property(nonatomic, copy) NSArray<NSNumber *> *systemHistory;
@end

@implementation CQCPUChartView
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirtyRect {
    [super drawRect:dirtyRect];
    NSRect bounds = NSInsetRect(self.bounds, 1.0, 1.0);
    [CQColor(39, 68, 85, 0.95) setStroke];
    for (NSInteger line = 1; line <= 3; line++) {
        CGFloat y = NSMinY(bounds) + NSHeight(bounds) * ((CGFloat)line / 4.0);
        NSBezierPath *grid = NSBezierPath.bezierPath;
        CGFloat dash[] = {3.0, 4.0};
        [grid setLineDash:dash count:2 phase:0.0];
        [grid moveToPoint:NSMakePoint(NSMinX(bounds), y)];
        [grid lineToPoint:NSMakePoint(NSMaxX(bounds), y)];
        grid.lineWidth = 0.7;
        [grid stroke];
    }
    NSUInteger count = self.totalHistory.count;
    if (count < 2) return;
    CGFloat step = NSWidth(bounds) / (CGFloat)(CQCPUHistoryLimit - 1);
    CGFloat xOffset = NSWidth(bounds) - step * (CGFloat)(count - 1);
    NSBezierPath *totalLine = NSBezierPath.bezierPath;
    totalLine.lineWidth = 1.7;
    for (NSUInteger index = 0; index < count; index++) {
        CGFloat x = NSMinX(bounds) + xOffset + step * (CGFloat)index;
        CGFloat value = MAX(0.0, MIN(100.0, self.totalHistory[index].doubleValue));
        CGFloat y = NSMaxY(bounds) - NSHeight(bounds) * (value / 100.0);
        index == 0 ? [totalLine moveToPoint:NSMakePoint(x, y)] : [totalLine lineToPoint:NSMakePoint(x, y)];
    }
    [CQColor(130, 181, 255, 1.0) setStroke];
    [totalLine stroke];

    NSUInteger systemCount = self.systemHistory.count;
    if (systemCount < 2) return;
    NSBezierPath *systemLine = NSBezierPath.bezierPath;
    systemLine.lineWidth = 1.4;
    CGFloat systemOffset = NSWidth(bounds) - step * (CGFloat)(systemCount - 1);
    for (NSUInteger index = 0; index < systemCount; index++) {
        CGFloat x = NSMinX(bounds) + systemOffset + step * (CGFloat)index;
        CGFloat value = MAX(0.0, MIN(100.0, self.systemHistory[index].doubleValue));
        CGFloat y = NSMaxY(bounds) - NSHeight(bounds) * (value / 100.0);
        index == 0 ? [systemLine moveToPoint:NSMakePoint(x, y)] : [systemLine lineToPoint:NSMakePoint(x, y)];
    }
    [CQColor(233, 120, 111, 1.0) setStroke];
    [systemLine stroke];
}
@end

@interface CQFanView : NSView
@property(nonatomic) double cpuPercent;
@property(nonatomic) CGFloat angle;
@property(nonatomic, strong) NSImage *fanImage;
@property(nonatomic, strong, nullable) NSTimer *animationTimer;
- (void)startAnimation;
- (void)stopAnimation;
@end

@implementation CQFanView
- (instancetype)initWithFrame:(NSRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        NSString *path = [NSBundle.mainBundle pathForResource:@"icon-fan" ofType:@"png"];
        _fanImage = [[NSImage alloc] initWithContentsOfFile:path];
    }
    return self;
}
- (BOOL)isFlipped { return YES; }
- (void)startAnimation {
    if (self.animationTimer != nil) return;
    self.animationTimer = [NSTimer timerWithTimeInterval:(1.0 / 30.0) target:self
                                                selector:@selector(animationTick:)
                                                userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:self.animationTimer forMode:NSRunLoopCommonModes];
}
- (void)stopAnimation { [self.animationTimer invalidate]; self.animationTimer = nil; }
- (void)animationTick:(NSTimer *)timer {
    (void)timer;
    self.angle += (CGFloat)(2.0 * M_PI * CQFanTurnsPerSecond(self.cpuPercent) / 30.0);
    if (self.angle > 2.0 * M_PI) self.angle -= (CGFloat)(2.0 * M_PI);
    self.needsDisplay = YES;
}
- (void)drawRect:(NSRect)dirtyRect {
    [super drawRect:dirtyRect];
    if (self.fanImage == nil) return;
    // 轴心来自参考风扇抠图的真实中心：24px 显示尺寸中的 (11.3, 12.1)。
    NSPoint hub = NSMakePoint(11.3, 12.1);
    [NSGraphicsContext saveGraphicsState];
    NSAffineTransform *transform = NSAffineTransform.transform;
    [transform translateXBy:hub.x yBy:hub.y];
    [transform rotateByRadians:self.angle];
    [transform translateXBy:-hub.x yBy:-hub.y];
    [transform concat];
    [self.fanImage drawInRect:self.bounds fromRect:NSZeroRect operation:NSCompositingOperationSourceOver
                     fraction:1.0 respectFlipped:YES hints:nil];
    [NSGraphicsContext restoreGraphicsState];
}
@end

@interface CQDashboardView : NSView
@property(nonatomic, strong) CQQuotaSnapshot *quotaSnapshot;
@property(nonatomic, strong) CQCPUChartView *chartView;
@property(nonatomic, strong) CQFanView *fanView;
@property(nonatomic, strong) NSImage *codexIcon;
@property(nonatomic, copy) NSString *memoryPressureLabel;
@property(nonatomic) double memoryPressurePosition;
@property(nonatomic) double currentCPUPercent;
- (void)updateQuota:(CQQuotaSnapshot *)snapshot refreshing:(BOOL)refreshing;
- (void)updateCPU:(double)cpu totalHistory:(NSArray<NSNumber *> *)totalHistory
     systemHistory:(NSArray<NSNumber *> *)systemHistory memoryPressure:(NSString *)memoryPressure
   pressurePosition:(double)pressurePosition;
@end

@implementation CQDashboardView

- (instancetype)initWithFrame:(NSRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        self.wantsLayer = YES;
        self.layer.cornerRadius = 22.0;
        self.layer.masksToBounds = YES;
        self.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
        _memoryPressureLabel = @"正常";
        _memoryPressurePosition = 0.15;
        NSString *iconPath = [NSBundle.mainBundle pathForResource:@"icon-codex-light" ofType:@"png"];
        _codexIcon = [[NSImage alloc] initWithContentsOfFile:iconPath];
        _chartView = [[CQCPUChartView alloc] initWithFrame:NSMakeRect(35.0, 584.0, 182.0, 58.0)];
        _chartView.totalHistory = @[];
        _chartView.systemHistory = @[];
        [self addSubview:_chartView];
        _fanView = [[CQFanView alloc] initWithFrame:NSMakeRect(35.0, 548.0, 24.0, 24.0)];
        [self addSubview:_fanView];
    }
    return self;
}

- (BOOL)isFlipped { return YES; }

- (void)updateQuota:(CQQuotaSnapshot *)snapshot refreshing:(BOOL)refreshing {
    (void)refreshing;
    self.quotaSnapshot = snapshot;
    self.needsDisplay = YES;
}

- (void)updateCPU:(double)cpu totalHistory:(NSArray<NSNumber *> *)totalHistory
     systemHistory:(NSArray<NSNumber *> *)systemHistory memoryPressure:(NSString *)memoryPressure
   pressurePosition:(double)pressurePosition {
    self.currentCPUPercent = cpu;
    self.chartView.totalHistory = totalHistory;
    self.chartView.systemHistory = systemHistory;
    self.chartView.needsDisplay = YES;
    self.fanView.cpuPercent = cpu;
    self.memoryPressureLabel = memoryPressure;
    self.memoryPressurePosition = pressurePosition;
    self.needsDisplay = YES;
}

- (NSDictionary *)attributesWithFont:(NSFont *)font color:(NSColor *)color {
    return @{NSFontAttributeName: font, NSForegroundColorAttributeName: color};
}

- (void)drawText:(NSString *)text at:(NSPoint)point font:(NSFont *)font color:(NSColor *)color {
    [text drawAtPoint:point withAttributes:[self attributesWithFont:font color:color]];
}

- (void)drawText:(NSString *)text right:(CGFloat)right y:(CGFloat)y font:(NSFont *)font color:(NSColor *)color {
    NSDictionary *attributes = [self attributesWithFont:font color:color];
    NSSize size = [text sizeWithAttributes:attributes];
    [text drawAtPoint:NSMakePoint(right - size.width, y) withAttributes:attributes];
}

- (void)drawCard:(NSRect)rect radius:(CGFloat)radius {
    NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius];
    [CQColor(7, 26, 40, 0.94) setFill];
    [path fill];
    [CQColor(31, 91, 130, 1.0) setStroke];
    path.lineWidth = 1.0;
    [path stroke];
}

- (NSString *)formattedResetDate {
    if (self.quotaSnapshot.resetDate == nil) return @"未知";
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.locale = [NSLocale localeWithLocaleIdentifier:@"zh_CN"];
    formatter.timeZone = NSTimeZone.localTimeZone;
    formatter.dateFormat = @"M 月 d 日 HH:mm";
    return [formatter stringFromDate:self.quotaSnapshot.resetDate];
}

- (NSString *)formattedCheckTime {
    if (self.quotaSnapshot.checkedAt == nil) return @"未知";
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.locale = [NSLocale localeWithLocaleIdentifier:@"zh_CN"];
    formatter.timeZone = NSTimeZone.localTimeZone;
    formatter.dateFormat = @"HH:mm:ss";
    return [formatter stringFromDate:self.quotaSnapshot.checkedAt];
}

- (void)drawQuotaSegmentsInRect:(NSRect)rect fraction:(double)fraction {
    CGFloat radius = 3.0;
    NSBezierPath *track = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius];
    [CQColor(22, 45, 61, 1.0) setFill];
    [track fill];
    [NSGraphicsContext saveGraphicsState];
    [track addClip];
    NSRect fill = rect;
    fill.size.width = rect.size.width * MAX(0.0, MIN(1.0, fraction));
    [CQColor(127, 165, 245, 1.0) setFill];
    NSRectFill(fill);
    CGFloat segment = rect.size.width / 14.0;
    [CQColor(7, 26, 40, 0.78) setFill];
    for (NSInteger index = 1; index < 14; index++) {
        CGFloat x = NSMinX(rect) + segment * index - 2.0;
        NSRectFill(NSMakeRect(x, NSMinY(rect), 4.0, NSHeight(rect)));
    }
    [NSGraphicsContext restoreGraphicsState];
}

- (void)drawTokenBarsInRect:(NSRect)rect {
    [CQColor(63, 115, 145, 0.13) setStroke];
    for (NSInteger row = 1; row <= 2; row++) {
        CGFloat y = NSMinY(rect) + NSHeight(rect) * (CGFloat)row / 3.0;
        NSBezierPath *line = NSBezierPath.bezierPath;
        [line moveToPoint:NSMakePoint(NSMinX(rect), y)];
        [line lineToPoint:NSMakePoint(NSMaxX(rect), y)];
        line.lineWidth = 0.6;
        [line stroke];
    }
    [CQColor(63, 115, 145, 0.42) setStroke];
    NSBezierPath *baseline = NSBezierPath.bezierPath;
    [baseline moveToPoint:NSMakePoint(NSMinX(rect), NSMaxY(rect))];
    [baseline lineToPoint:NSMakePoint(NSMaxX(rect), NSMaxY(rect))];
    baseline.lineWidth = 0.8;
    [baseline stroke];

    NSArray<NSNumber *> *values = self.quotaSnapshot.dailyTokenUsage;
    if (values.count == 0) return;
    double maxValue = 0;
    for (NSNumber *number in values) maxValue = MAX(maxValue, number.doubleValue);
    CGFloat gap = 3.0;
    CGFloat barWidth = (NSWidth(rect) - gap * (values.count - 1)) / values.count;
    CGFloat baselineY = NSMaxY(rect);
    for (NSUInteger index = 0; index < values.count; index++) {
        double ratio = maxValue > 0 ? values[index].doubleValue / maxValue : 0.0;
        CGFloat height = ratio > 0 ? MAX(4.0, (NSHeight(rect) - 8.0) * ratio) : 3.0;
        CGFloat x = NSMinX(rect) + (barWidth + gap) * index;
        NSRect barRect = NSMakeRect(x, baselineY - height, MAX(1.5, barWidth), height);
        NSBezierPath *bar = [NSBezierPath bezierPathWithRoundedRect:barRect xRadius:2.5 yRadius:2.5];
        if (ratio <= 0) {
            [CQColor(22, 45, 61, 0.9) setFill];
            [bar fill];
        } else {
            NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:CQColor(169, 188, 255, 1.0)
                                                                 endingColor:CQColor(82, 111, 218, 1.0)];
            [gradient drawInBezierPath:bar angle:90.0];
        }
    }
}

- (void)drawMemoryGaugeInRect:(NSRect)rect {
    NSBezierPath *bar = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:4.0 yRadius:4.0];
    NSGradient *gradient = [[NSGradient alloc] initWithColorsAndLocations:
        CQColor(104, 193, 109, 1.0), 0.0, CQColor(215, 198, 44, 1.0), 0.58,
        CQColor(236, 117, 105, 1.0), 1.0, nil];
    [gradient drawInBezierPath:bar angle:0.0];
    CGFloat markerX = NSMinX(rect) + NSWidth(rect) * (CGFloat)MAX(0.03, MIN(0.97, self.memoryPressurePosition));
    NSRect marker = NSMakeRect(markerX - 6.0, NSMidY(rect) - 6.0, 12.0, 12.0);
    [CQColor(8, 27, 41, 1.0) setFill];
    [[NSBezierPath bezierPathWithOvalInRect:marker] fill];
    [CQColor(238, 245, 250, 1.0) setStroke];
    NSBezierPath *outline = [NSBezierPath bezierPathWithOvalInRect:marker];
    outline.lineWidth = 2.0;
    [outline stroke];
}

- (void)drawRect:(NSRect)dirtyRect {
    [super drawRect:dirtyRect];
    NSBezierPath *surface = [NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:22.0 yRadius:22.0];
    NSGradient *background = [[NSGradient alloc] initWithStartingColor:CQColor(10, 32, 48, 1.0)
                                                            endingColor:CQColor(5, 16, 26, 1.0)];
    [background drawInBezierPath:surface angle:270.0];

    NSColor *foreground = CQColor(240, 245, 250, 1.0);
    NSColor *secondary = CQColor(166, 184, 200, 1.0);
    NSColor *muted = CQColor(113, 135, 154, 1.0);
    NSColor *cyan = CQColor(114, 212, 230, 1.0);
    NSFont *mono12 = [NSFont monospacedSystemFontOfSize:12.0 weight:NSFontWeightRegular];

    [self drawText:@"Codex 使用额度" at:NSMakePoint(18.0, 20.0)
              font:[NSFont systemFontOfSize:24.0 weight:NSFontWeightMedium] color:foreground];
    [self drawText:@"刚刚更新 · 本地实时数据" at:NSMakePoint(18.0, 53.0)
              font:[NSFont systemFontOfSize:12.0 weight:NSFontWeightRegular] color:muted];

    NSRect usageCard = NSMakeRect(18.0, 98.0, 434.0, 390.0);
    [self drawCard:usageCard radius:17.0];
    if (self.codexIcon != nil) {
        [self.codexIcon drawInRect:NSMakeRect(35.0, 114.0, 25.0, 25.0) fromRect:NSZeroRect
                         operation:NSCompositingOperationSourceOver fraction:1.0
                    respectFlipped:YES hints:nil];
    }
    [self drawText:@"Codex" at:NSMakePoint(70.0, 116.0)
              font:[NSFont systemFontOfSize:18.0 weight:NSFontWeightMedium] color:foreground];
    [self drawText:@"⌄" at:NSMakePoint(127.0, 116.0)
              font:[NSFont systemFontOfSize:18.0 weight:NSFontWeightRegular] color:muted];
    NSString *plan = [NSString stringWithFormat:@"订阅：%@", CQPlanDisplayName(self.quotaSnapshot.planType)];
    [self drawText:plan right:435.0 y:119.0
              font:[NSFont systemFontOfSize:12.0 weight:NSFontWeightRegular] color:secondary];

    BOOL available = self.quotaSnapshot.isAvailable;
    NSInteger remaining = available ? self.quotaSnapshot.remainingPercent.integerValue : 0;
    [self drawText:@"7 天窗口" at:NSMakePoint(35.0, 158.0)
              font:[NSFont systemFontOfSize:14.0 weight:NSFontWeightRegular] color:secondary];
    NSString *remainingText = available ? [NSString stringWithFormat:@"%ld%% 剩余", (long)remaining] : @"— 剩余";
    [self drawText:remainingText right:435.0 y:155.0
              font:[NSFont monospacedDigitSystemFontOfSize:18.0 weight:NSFontWeightMedium] color:foreground];
    [self drawQuotaSegmentsInRect:NSMakeRect(35.0, 187.0, 400.0, 8.0)
                         fraction:(available ? remaining / 100.0 : 0.0)];
    [self drawText:[NSString stringWithFormat:@"● 检查于 %@", self.formattedCheckTime]
                 at:NSMakePoint(35.0, 210.0) font:mono12 color:secondary];
    NSString *resetStatus = self.quotaSnapshot.resetDate == nil ? @"↻ 距离重置时间未知" :
        [NSString stringWithFormat:@"↻ 距离重置还有 %@ · %@",
                                   CQFormatResetCountdown(self.quotaSnapshot.resetDate, NSDate.date),
                                   self.formattedResetDate];
    [self drawText:resetStatus at:NSMakePoint(35.0, 233.0) font:mono12 color:secondary];

    [CQColor(63, 115, 145, 0.36) setStroke];
    NSBezierPath *usageDivider = NSBezierPath.bezierPath;
    [usageDivider moveToPoint:NSMakePoint(35.0, 270.0)];
    [usageDivider lineToPoint:NSMakePoint(435.0, 270.0)];
    usageDivider.lineWidth = 0.8;
    [usageDivider stroke];

    [self drawText:@"本月 Token 使用量" at:NSMakePoint(35.0, 287.0)
              font:[NSFont systemFontOfSize:15.0 weight:NSFontWeightMedium] color:secondary];
    [self drawText:@"MONTHLY" right:435.0 y:289.0
              font:[NSFont monospacedSystemFontOfSize:10.0 weight:NSFontWeightRegular] color:muted];
    [self drawText:CQFormatTokenCount(self.quotaSnapshot.monthlyTokens) at:NSMakePoint(35.0, 316.0)
              font:[NSFont monospacedDigitSystemFontOfSize:29.0 weight:NSFontWeightMedium] color:foreground];
    NSDictionary *tokenAttrs = [self attributesWithFont:[NSFont systemFontOfSize:12.0] color:muted];
    NSSize totalSize = [CQFormatTokenCount(self.quotaSnapshot.monthlyTokens) sizeWithAttributes:
                        [self attributesWithFont:[NSFont monospacedDigitSystemFontOfSize:29.0 weight:NSFontWeightMedium]
                                                                  color:foreground]];
    [@"tokens" drawAtPoint:NSMakePoint(43.0 + totalSize.width, 330.0) withAttributes:tokenAttrs];
    [self drawTokenBarsInRect:NSMakeRect(35.0, 356.0, 400.0, 74.0)];
    NSArray<NSNumber *> *labelDays = @[@1, @5, @10, @15, @20, @25, @30];
    NSUInteger dayCount = MAX((NSUInteger)30, self.quotaSnapshot.dailyTokenUsage.count);
    for (NSNumber *day in labelDays) {
        CGFloat fraction = (day.doubleValue - 1.0) / MAX(1.0, (double)dayCount - 1.0);
        NSString *label = [NSString stringWithFormat:@"%@ 日", day];
        NSDictionary *attrs = [self attributesWithFont:[NSFont monospacedSystemFontOfSize:10.0 weight:NSFontWeightRegular]
                                                   color:muted];
        NSSize size = [label sizeWithAttributes:attrs];
        CGFloat x = 35.0 + 400.0 * fraction - size.width / 2.0;
        x = MAX(35.0, MIN(435.0 - size.width, x));
        [label drawAtPoint:NSMakePoint(x, 438.0) withAttributes:attrs];
    }
    NSNumber *dailyPeak = CQPeakDailyTokens(self.quotaSnapshot.dailyTokenUsage ?: @[]);
    NSNumber *dailyAverage = CQAverageRecordedDailyTokens(self.quotaSnapshot.dailyTokenUsage ?: @[]);
    NSString *dailySummary = [NSString stringWithFormat:@"单日峰值 %@ · 日均 %@",
                                                        CQFormatTokenCount(dailyPeak),
                                                        CQFormatTokenCount(dailyAverage)];
    [self drawText:dailySummary at:NSMakePoint(35.0, 461.0)
              font:[NSFont systemFontOfSize:11.0 weight:NSFontWeightRegular] color:muted];
    [self drawText:@"本月" right:435.0 y:461.0
              font:[NSFont systemFontOfSize:11.0 weight:NSFontWeightRegular] color:muted];

    NSRect localCard = NSMakeRect(18.0, 502.0, 434.0, 164.0);
    [self drawCard:localCard radius:17.0];
    [self drawText:@"本机状态" at:NSMakePoint(35.0, 518.0)
              font:[NSFont systemFontOfSize:15.0 weight:NSFontWeightMedium] color:secondary];
    [self drawText:@"实时 · 每秒采样" right:435.0 y:520.0
              font:[NSFont monospacedSystemFontOfSize:10.0 weight:NSFontWeightRegular] color:muted];

    [self drawText:@"CPU 负载" at:NSMakePoint(66.0, 551.0)
              font:[NSFont systemFontOfSize:13.0 weight:NSFontWeightRegular] color:secondary];
    [self drawText:[NSString stringWithFormat:@"%.0f%%", self.currentCPUPercent]
                 at:NSMakePoint(128.0, 548.0)
              font:[NSFont monospacedDigitSystemFontOfSize:18.0 weight:NSFontWeightMedium] color:foreground];

    NSBezierPath *localDivider = NSBezierPath.bezierPath;
    [localDivider moveToPoint:NSMakePoint(234.0, 548.0)];
    [localDivider lineToPoint:NSMakePoint(234.0, 650.0)];
    localDivider.lineWidth = 0.8;
    [CQColor(63, 115, 145, 0.36) setStroke];
    [localDivider stroke];

    [self drawText:@"内存压力" at:NSMakePoint(251.0, 551.0)
              font:[NSFont systemFontOfSize:13.0 weight:NSFontWeightRegular] color:secondary];
    NSColor *pressureColor = [self.memoryPressureLabel isEqualToString:@"正常"] ? CQColor(104, 193, 109, 1.0) :
        ([self.memoryPressureLabel isEqualToString:@"注意"] ? CQColor(215, 198, 44, 1.0) : CQColor(236, 117, 105, 1.0));
    [pressureColor setFill];
    [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(316.0, 555.0, 8.0, 8.0)] fill];
    [self drawText:(self.memoryPressureLabel ?: @"正常") at:NSMakePoint(251.0, 577.0)
              font:[NSFont systemFontOfSize:24.0 weight:NSFontWeightMedium] color:foreground];
    [self drawMemoryGaugeInRect:NSMakeRect(251.0, 616.0, 182.0, 8.0)];
    [self drawText:@"正常" at:NSMakePoint(251.0, 632.0)
              font:[NSFont systemFontOfSize:10.0 weight:NSFontWeightRegular] color:muted];
    [self drawText:@"紧张" right:433.0 y:632.0
              font:[NSFont systemFontOfSize:10.0 weight:NSFontWeightRegular] color:muted];

    NSBezierPath *footerLine = NSBezierPath.bezierPath;
    [footerLine moveToPoint:NSMakePoint(18.0, 682.0)];
    [footerLine lineToPoint:NSMakePoint(452.0, 682.0)];
    footerLine.lineWidth = 0.8;
    [CQColor(63, 115, 145, 0.36) setStroke];
    [footerLine stroke];
    [self drawText:@"本地实时数据" at:NSMakePoint(18.0, 702.0)
              font:[NSFont monospacedSystemFontOfSize:11.0 weight:NSFontWeightMedium] color:cyan];
    [self drawText:@"Codex 每周额度监控" right:452.0 y:702.0
              font:[NSFont monospacedSystemFontOfSize:11.0 weight:NSFontWeightRegular] color:muted];
}

@end

@interface CQBorderlessPanel : NSPanel
@end

@implementation CQBorderlessPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface CQMenuBarController : NSObject <NSWindowDelegate>
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong, nullable) CQBorderlessPanel *panel;
@property(nonatomic, strong, nullable) NSWindow *previewWindow;
@property(nonatomic, strong) CQDashboardView *dashboardView;
@property(nonatomic, strong) CQRateLimitReader *reader;
@property(nonatomic, strong) CQQuotaSnapshot *snapshot;
@property(nonatomic, strong) CQSystemMonitor *systemMonitor;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *cpuTotalHistory;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *cpuSystemHistory;
@property(nonatomic, strong) NSTimer *quotaRefreshTimer;
@property(nonatomic, strong, nullable) NSTimer *systemTimer;
@property(nonatomic, strong) NSImage *menuIcon;
@property(nonatomic) BOOL refreshInFlight;
@property(nonatomic) BOOL previewMode;
@property(nonatomic, strong, nullable) NSDate *lastPanelCloseDate;
@end

@implementation CQMenuBarController

- (instancetype)init {
    self = [super init];
    if (!self) return nil;
    _reader = [[CQRateLimitReader alloc] init];
    _snapshot = [CQQuotaSnapshot failureWithMessage:@"正在读取" checkedAt:NSDate.date];
    _systemMonitor = [[CQSystemMonitor alloc] init];
    _cpuTotalHistory = [NSMutableArray array];
    _cpuSystemHistory = [NSMutableArray array];
    _previewMode = [NSProcessInfo.processInfo.arguments containsObject:@"--preview-window"];

    // 使用系统变量宽度状态项，并保持未命名；不启用位置持久化，避免 macOS 26
    // 把曾经隐藏或越界的位置重新应用到后续启动。
    _statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    NSString *iconPath = [NSBundle.mainBundle pathForResource:@"icon-codex-light" ofType:@"png"];
    _menuIcon = [[NSImage alloc] initWithContentsOfFile:iconPath];
    _menuIcon.size = NSMakeSize(18.0, 18.0);
    _menuIcon.template = NO;
    NSStatusBarButton *button = _statusItem.button;
    button.image = _menuIcon;
    button.imagePosition = NSImageLeft;
    button.imageScaling = NSImageScaleProportionallyDown;
    button.imageHugsTitle = YES;
    button.font = [NSFont systemFontOfSize:13.0 weight:NSFontWeightMedium];
    button.title = @"…";
    button.toolTip = @"Codex 每周额度";
    button.target = self;
    button.action = @selector(togglePanel:);
    _statusItem.visible = YES;

    NSView *container = [self makeDashboardContainer];
    if (_previewMode) {
        _previewWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, CQPanelWidth, CQPanelHeight)
                                                     styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable)
                                                       backing:NSBackingStoreBuffered defer:NO];
        _previewWindow.title = @"Codex 使用额度";
        _previewWindow.contentView = container;
        _previewWindow.releasedWhenClosed = NO;
        [_previewWindow center];
        [_previewWindow makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        [self startSystemUpdates];
    } else {
        // NSMenu 会强制绘制系统外框；透明无边框 Panel 才能真正做到零边界线。
        _panel = [[CQBorderlessPanel alloc]
            initWithContentRect:NSMakeRect(0, 0, CQPanelWidth, CQPanelHeight)
                      styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
                        backing:NSBackingStoreBuffered
                          defer:NO];
        _panel.contentView = container;
        _panel.opaque = NO;
        _panel.backgroundColor = NSColor.clearColor;
        _panel.hasShadow = NO;
        _panel.floatingPanel = YES;
        _panel.becomesKeyOnlyIfNeeded = YES;
        _panel.level = NSPopUpMenuWindowLevel;
        _panel.collectionBehavior = (NSWindowCollectionBehaviorTransient |
                                     NSWindowCollectionBehaviorMoveToActiveSpace |
                                     NSWindowCollectionBehaviorFullScreenAuxiliary);
        _panel.animationBehavior = NSWindowAnimationBehaviorNone;
        _panel.releasedWhenClosed = NO;
        _panel.delegate = self;
    }
    [self.dashboardView updateQuota:self.snapshot refreshing:NO];
    [self refresh];
    _quotaRefreshTimer = [NSTimer scheduledTimerWithTimeInterval:CQQuotaRefreshSeconds target:self
                                                        selector:@selector(quotaRefreshTimerFired:)
                                                        userInfo:nil repeats:YES];
    return self;
}

- (NSView *)makeDashboardContainer {
    NSView *container = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, CQPanelWidth, CQPanelHeight)];
    container.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    self.dashboardView = [[CQDashboardView alloc] initWithFrame:container.bounds];
    self.dashboardView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [container addSubview:self.dashboardView];
    return container;
}

- (void)dealloc {
    [self.quotaRefreshTimer invalidate];
    [self.systemTimer invalidate];
    [self.dashboardView.fanView stopAnimation];
    self.panel.delegate = nil;
}

- (void)positionPanelBelowStatusItem {
    NSStatusBarButton *button = self.statusItem.button;
    NSWindow *buttonWindow = button.window;
    NSScreen *screen = buttonWindow.screen ?: NSScreen.mainScreen;
    if (buttonWindow == nil || screen == nil || self.panel == nil) return;
    NSRect buttonRectInWindow = [button convertRect:button.bounds toView:nil];
    NSRect buttonFrame = [buttonWindow convertRectToScreen:buttonRectInWindow];
    NSRect available = screen.visibleFrame;
    CGFloat x = NSMidX(buttonFrame) - CQPanelWidth / 2.0;
    x = MAX(NSMinX(available) + 8.0, MIN(x, NSMaxX(available) - CQPanelWidth - 8.0));
    CGFloat y = NSMinY(buttonFrame) - CQPanelHeight - 4.0;
    if (y < NSMinY(available) + 8.0) y = NSMaxY(buttonFrame) + 4.0;
    [self.panel setFrameOrigin:NSMakePoint(round(x), round(y))];
}

- (void)togglePanel:(id)sender {
    (void)sender;
    if (self.previewMode || self.panel == nil) return;
    if (self.panel.visible) {
        [self closePanel];
        return;
    }
    if (self.lastPanelCloseDate != nil && -self.lastPanelCloseDate.timeIntervalSinceNow < 0.25) return;
    [self positionPanelBelowStatusItem];
    [self refresh];
    [self startSystemUpdates];
    [self.panel makeKeyAndOrderFront:nil];
}

- (void)closePanel {
    if (self.panel == nil || !self.panel.visible) return;
    self.lastPanelCloseDate = NSDate.date;
    [self.panel orderOut:nil];
    [self stopSystemUpdates];
}

- (void)windowDidResignKey:(NSNotification *)notification {
    if (notification.object == self.panel) [self closePanel];
}

- (void)quotaRefreshTimerFired:(NSTimer *)timer { (void)timer; [self refresh]; }
- (NSString *)menuBarTitle {
    if (self.snapshot.isAvailable) return [NSString stringWithFormat:@"%@%%", self.snapshot.remainingPercent];
    return self.refreshInFlight ? @"…" : @"—";
}
- (void)refresh {
    if (self.refreshInFlight) return;
    self.refreshInFlight = YES;
    if (!self.snapshot.isAvailable) self.statusItem.button.title = @"…";
    [self.dashboardView updateQuota:self.snapshot refreshing:YES];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        CQQuotaSnapshot *result = [self.reader readSynchronously];
        dispatch_async(dispatch_get_main_queue(), ^{
            self.snapshot = result;
            self.refreshInFlight = NO;
            self.statusItem.button.title = self.menuBarTitle;
            [self.dashboardView updateQuota:result refreshing:NO];
        });
    });
}
- (void)startSystemUpdates {
    if (self.systemTimer != nil) return;
    (void)[self.systemMonitor sample];
    [self.dashboardView.fanView startAnimation];
    [self sampleSystem:nil];
    self.systemTimer = [NSTimer timerWithTimeInterval:CQSystemSampleSeconds target:self
                                             selector:@selector(sampleSystem:) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:self.systemTimer forMode:NSRunLoopCommonModes];
}
- (void)stopSystemUpdates {
    [self.systemTimer invalidate]; self.systemTimer = nil;
    [self.dashboardView.fanView stopAnimation];
}
- (void)sampleSystem:(NSTimer *)timer {
    (void)timer;
    CQSystemSample *sample = [self.systemMonitor sample];
    [self.cpuTotalHistory addObject:@(sample.cpuTotalPercent)];
    [self.cpuSystemHistory addObject:@(sample.cpuSystemPercent)];
    while (self.cpuTotalHistory.count > CQCPUHistoryLimit) [self.cpuTotalHistory removeObjectAtIndex:0];
    while (self.cpuSystemHistory.count > CQCPUHistoryLimit) [self.cpuSystemHistory removeObjectAtIndex:0];
    [self.dashboardView updateCPU:sample.cpuTotalPercent totalHistory:self.cpuTotalHistory.copy
                    systemHistory:self.cpuSystemHistory.copy memoryPressure:sample.memoryPressureLabel
                  pressurePosition:sample.memoryPressurePosition];
}

@end


@interface CQAppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) CQMenuBarController *menuBarController;
@end
@implementation CQAppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    self.menuBarController = [[CQMenuBarController alloc] init];
}
@end

static BOOL CQRunSelfTests(void) {
    NSDate *checkedAt = [NSDate dateWithTimeIntervalSince1970:1700000000];
    NSDictionary *weeklyPayload = @{@"rateLimits": @{
        @"planType": @"pro", @"primary": @{@"usedPercent": @43,
        @"windowDurationMins": @10080, @"resetsAt": @1786756753}}};
    CQQuotaSnapshot *weekly = [CQRateLimitReader snapshotFromRatePayload:weeklyPayload checkedAt:checkedAt];
    if (!weekly.isAvailable || weekly.remainingPercent.integerValue != 57 ||
        ![weekly.planType isEqualToString:@"pro"]) {
        fprintf(stderr, "SELF-TEST FAIL: weekly percentage or plan\n"); return NO;
    }
    NSDictionary *byIDPayload = @{@"rateLimitsByLimitId": @{@"codex": @{
        @"primary": @{@"usedPercent": @12, @"windowDurationMins": @10080,
        @"resetsAt": @1786756753}}}};
    CQQuotaSnapshot *byID = [CQRateLimitReader snapshotFromRatePayload:byIDPayload checkedAt:checkedAt];
    if (!byID.isAvailable || byID.remainingPercent.integerValue != 88) {
        fprintf(stderr, "SELF-TEST FAIL: by-limit-id response\n"); return NO;
    }
    NSDictionary *shortPayload = @{@"rateLimits": @{@"primary": @{
        @"usedPercent": @43, @"windowDurationMins": @60, @"resetsAt": @1786756753}}};
    if ([CQRateLimitReader snapshotFromRatePayload:shortPayload checkedAt:checkedAt].isAvailable) {
        fprintf(stderr, "SELF-TEST FAIL: non-weekly window accepted\n"); return NO;
    }
    NSCalendar *calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
    NSDateComponents *parts = [[NSDateComponents alloc] init];
    parts.year = 2026; parts.month = 8; parts.day = 10;
    NSDate *monthDate = [calendar dateFromComponents:parts];
    NSDictionary *usage = @{@"dailyUsageBuckets": @[
        @{@"startDate": @"2026-08-01", @"tokens": @1000},
        @{@"startDate": @"2026-08-10", @"tokens": @2500},
        @{@"startDate": @"2026-07-31", @"tokens": @9000}]};
    [CQRateLimitReader applyUsagePayload:usage toSnapshot:weekly now:monthDate];
    if (weekly.monthlyTokens.longLongValue != 3500 || weekly.dailyTokenUsage.count != 31) {
        fprintf(stderr, "SELF-TEST FAIL: monthly token aggregation\n"); return NO;
    }
    NSNumber *average = CQAverageRecordedDailyTokens(weekly.dailyTokenUsage);
    NSNumber *peak = CQPeakDailyTokens(weekly.dailyTokenUsage);
    if (average.longLongValue != 1750 || peak.longLongValue != 2500) {
        fprintf(stderr, "SELF-TEST FAIL: monthly token summary\n"); return NO;
    }
    NSDate *countdownNow = [NSDate dateWithTimeIntervalSince1970:1700000000];
    NSDate *countdownReset = [countdownNow dateByAddingTimeInterval:(5 * 24 + 15) * 3600];
    if (![CQFormatResetCountdown(countdownReset, countdownNow)
          isEqualToString:@"5 天 15 小时"] ||
        ![CQFormatResetCountdown([countdownNow dateByAddingTimeInterval:1800], countdownNow)
          isEqualToString:@"不足 1 小时"]) {
        fprintf(stderr, "SELF-TEST FAIL: reset countdown formatting\n"); return NO;
    }
    if (![CQMemoryPressureLabelForAvailableRatio(0.30) isEqualToString:@"正常"] ||
        ![CQMemoryPressureLabelForAvailableRatio(0.10) isEqualToString:@"注意"] ||
        ![CQMemoryPressureLabelForAvailableRatio(0.03) isEqualToString:@"紧张"] ||
        !(CQFanTurnsPerSecond(85.0) > CQFanTurnsPerSecond(20.0))) {
        fprintf(stderr, "SELF-TEST FAIL: system mappings\n"); return NO;
    }
    printf("SELF-TEST PASS\n");
    return YES;
}

static BOOL CQRenderPreview(NSString *path) {
    CQQuotaSnapshot *snapshot = [[[CQRateLimitReader alloc] init] readSynchronously];
    if (!snapshot.isAvailable) {
        fprintf(stderr, "%s\n", (snapshot.errorMessage ?: @"暂时无法读取").UTF8String);
        return NO;
    }
    CQSystemMonitor *monitor = [[CQSystemMonitor alloc] init];
    (void)[monitor sample];
    NSMutableArray<NSNumber *> *totals = [NSMutableArray array];
    NSMutableArray<NSNumber *> *systems = [NSMutableArray array];
    CQSystemSample *sample = nil;
    for (NSInteger index = 0; index < 24; index++) {
        usleep(80000);
        sample = [monitor sample];
        [totals addObject:@(sample.cpuTotalPercent)];
        [systems addObject:@(sample.cpuSystemPercent)];
    }
    CQDashboardView *view = [[CQDashboardView alloc] initWithFrame:NSMakeRect(0, 0, CQPanelWidth, CQPanelHeight)];
    [view updateQuota:snapshot refreshing:NO];
    [view updateCPU:sample.cpuTotalPercent totalHistory:totals systemHistory:systems
      memoryPressure:sample.memoryPressureLabel pressurePosition:sample.memoryPressurePosition];
    NSBitmapImageRep *rep = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
    [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    NSError *error = nil;
    BOOL ok = [png writeToFile:path options:NSDataWritingAtomic error:&error];
    if (!ok) fprintf(stderr, "Render failed: %s\n", error.localizedDescription.UTF8String);
    return ok;
}

static BOOL CQPrintStatusFrame(void) {
    NSApplication *application = NSApplication.sharedApplication;
    [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSStatusItem *item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    NSString *iconPath = [NSBundle.mainBundle pathForResource:@"icon-codex-light" ofType:@"png"];
    NSImage *icon = [[NSImage alloc] initWithContentsOfFile:iconPath];
    icon.size = NSMakeSize(18.0, 18.0);
    icon.template = NO;
    item.button.image = icon;
    item.button.imagePosition = NSImageLeft;
    item.button.imageScaling = NSImageScaleProportionallyDown;
    item.button.font = [NSFont systemFontOfSize:13.0 weight:NSFontWeightMedium];
    item.button.title = @"45%";
    item.visible = YES;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1.0];
    while (deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:
            [NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    NSRect frame = item.button.window.frame;
    NSScreen *screen = item.button.window.screen ?: NSScreen.mainScreen;
    BOOL onScreen = screen != nil && NSIntersectsRect(frame, screen.frame) &&
                    NSMinY(frame) >= NSMinY(screen.frame) && NSMaxY(frame) <= NSMaxY(screen.frame);
    printf("Status frame: x=%.0f y=%.0f w=%.0f h=%.0f\n", frame.origin.x, frame.origin.y,
           frame.size.width, frame.size.height);
    if (screen != nil) {
        printf("Screen frame: x=%.0f y=%.0f w=%.0f h=%.0f\n", screen.frame.origin.x,
               screen.frame.origin.y, screen.frame.size.width, screen.frame.size.height);
    }
    printf("Status item on screen: %s\n", onScreen ? "YES" : "NO");
    [NSStatusBar.systemStatusBar removeStatusItem:item];
    return onScreen;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        (void)argc; (void)argv;
        NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
        if ([arguments containsObject:@"--self-test"]) return CQRunSelfTests() ? 0 : 1;
        if ([arguments containsObject:@"--print-quota"]) {
            CQQuotaSnapshot *snapshot = [[[CQRateLimitReader alloc] init] readSynchronously];
            if (!snapshot.isAvailable) {
                fprintf(stderr, "%s\n", (snapshot.errorMessage ?: @"暂时无法读取").UTF8String); return 1;
            }
            printf("Weekly remaining: %ld%%\n", (long)snapshot.remainingPercent.integerValue);
            printf("Plan: %s\n", CQPlanDisplayName(snapshot.planType).UTF8String);
            printf("Monthly tokens: %lld\n", snapshot.monthlyTokens.longLongValue);
            if (snapshot.resetDate != nil) printf("Reset timestamp: %.0f\n", snapshot.resetDate.timeIntervalSince1970);
            return 0;
        }
        if ([arguments containsObject:@"--print-system"]) {
            CQSystemMonitor *monitor = [[CQSystemMonitor alloc] init];
            (void)[monitor sample]; usleep(300000);
            CQSystemSample *sample = [monitor sample];
            printf("CPU total: %.1f%%\nCPU system: %.1f%%\nMemory pressure: %s\n",
                   sample.cpuTotalPercent, sample.cpuSystemPercent, sample.memoryPressureLabel.UTF8String);
            return 0;
        }
        if ([arguments containsObject:@"--print-status-frame"]) {
            return CQPrintStatusFrame() ? 0 : 1;
        }
        NSUInteger renderIndex = [arguments indexOfObject:@"--render-preview"];
        if (renderIndex != NSNotFound && renderIndex + 1 < arguments.count) {
            (void)NSApplication.sharedApplication;
            return CQRenderPreview(arguments[renderIndex + 1]) ? 0 : 1;
        }
        NSApplication *application = NSApplication.sharedApplication;
        CQAppDelegate *delegate = [[CQAppDelegate alloc] init];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
