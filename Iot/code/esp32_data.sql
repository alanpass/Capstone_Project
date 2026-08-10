-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- 主機： 127.0.0.1
-- 產生時間： 2026-01-03 06:06:18
-- 伺服器版本： 10.4.32-MariaDB
-- PHP 版本： 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- 資料庫： `esp32_data`
--

-- --------------------------------------------------------

--
-- 資料表結構 `user_thresholds`
--

CREATE TABLE `user_thresholds` (
  `uid` varchar(191) NOT NULL COMMENT '使用者唯一識別碼 (Firebase UID)',
  `tempMax` float NOT NULL COMMENT '溫度上限',
  `tempMin` float NOT NULL COMMENT '溫度下限',
  `humidMax` float NOT NULL COMMENT '濕度上限',
  `humidMin` float NOT NULL COMMENT '濕度下限',
  `updatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '最後更新時間'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- 傾印資料表的資料 `user_thresholds`
--

INSERT INTO `user_thresholds` (`uid`, `tempMax`, `tempMin`, `humidMax`, `humidMin`, `updatedAt`) VALUES
('QpqRmXT46IXTbSV0zQ7wPBNGtJj2', 23, 20, 3070, 0, '2025-11-30 23:38:40');

--
-- 已傾印資料表的索引
--

--
-- 資料表索引 `user_thresholds`
--
ALTER TABLE `user_thresholds`
  ADD PRIMARY KEY (`uid`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
